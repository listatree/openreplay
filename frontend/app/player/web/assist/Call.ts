import type Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';

import type { LocalStream } from './LocalStream';
import type { Socket } from './types'
import type { Store } from '../../common/types'

import appStore from 'App/store';


export enum CallingState {
	NoCall,
	Connecting,
	Requesting,
	Reconnecting,
	OnCall,
}

export interface State {
	calling: CallingState;
}

export default class Call {
	static readonly INITIAL_STATE: Readonly<State> = {
		calling: CallingState.NoCall
	}

	private _peer: Peer | null = null
	private connectionAttempts: number = 0
	private callConnection: MediaConnection[] = []
	private videoStreams: Record<string, MediaStreamTrack> = {}

	constructor(
		private store: Store<State>,
		private socket: Socket,
		private config: RTCIceServer[],
		private peerID: string,
	) {
		socket.on('call_end', this.onRemoteCallEnd)
		socket.on('videofeed', ({ streamId, enabled }) => {
      console.log(streamId, enabled)
      console.log(this.videoStreams)
      if (this.videoStreams[streamId]) {
        this.videoStreams[streamId].enabled = enabled
      }
      console.log(this.videoStreams)
    })
    let reconnecting = false
    socket.on('SESSION_DISCONNECTED', () => {
  	  if (this.store.get().calling === CallingState.OnCall) {
        this.store.update({ calling: CallingState.Reconnecting })
        reconnecting = true
      } else if (this.store.get().calling === CallingState.Requesting){
        this.store.update({ calling: CallingState.NoCall })
      }
    })
    socket.on('messages', () => {
    	if (reconnecting) { // 'messages' come frequently, so it is better to have Reconnecting
    		this._callSessionPeer()
    		reconnecting = false
    	}
    })
    socket.on("disconnect", () => {
      this.store.update({ calling: CallingState.NoCall })
    })
	}

	private getPeer(): Promise<Peer> {
		if (this._peer && !this._peer.disconnected) { return Promise.resolve(this._peer) }

		// @ts-ignore
		const urlObject = new URL(window.env.API_EDP || window.location.origin)

		// @ts-ignore TODO: set module in ts settings
		return import('peerjs').then(({ default: Peer }) => {
			if (this.cleaned) {return Promise.reject("Already cleaned")}
			const peerOpts: Peer.PeerJSOption = {
				host: urlObject.hostname,
				path: '/assist',
				port: urlObject.port === "" ? (location.protocol === 'https:' ? 443 : 80 ): parseInt(urlObject.port),
			}
			if (this.config) {
				peerOpts['config'] = {
					iceServers: this.config,
					//@ts-ignore
					sdpSemantics: 'unified-plan',
					iceTransportPolicy: 'relay',
				};
			}
			const peer = this._peer = new Peer(peerOpts)
			peer.on('call', call => {
				console.log('getting call from', call.peer)
					call.answer(this.callArgs.localStream.stream)
					this.callConnection.push(call)

					this.callArgs.localStream.onVideoTrack(vTrack => {
						const sender = call.peerConnection.getSenders().find(s => s.track?.kind === "video")
						if (!sender) {
							console.warn("No video sender found")
							return
						}
						sender.replaceTrack(vTrack)
					})

					call.on('stream', stream => {
						this.videoStreams[call.peer] = stream.getVideoTracks()[0]
						this.callArgs && this.callArgs.onStream(stream)
					});
					// call.peerConnection.addEventListener("track", e => console.log('newtrack',e.track))

					call.on("close", this.onRemoteCallEnd)
					call.on("error", (e) => {
						console.error("PeerJS error (on call):", e)
						this.initiateCallEnd();
						this.callArgs && this.callArgs.onError && this.callArgs.onError();
					});
			})
			peer.on('error', e => {
				if (e.type === 'disconnected') {
					return peer.reconnect()
				} else if (e.type !== 'peer-unavailable') {
					console.error(`PeerJS error (on peer). Type ${e.type}`, e);
				}

			 //  call-reconnection connected
			 // if (['peer-unavailable', 'network', 'webrtc'].includes(e.type)) {
			 //    this.setStatus(this.connectionAttempts++ < MAX_RECONNECTION_COUNT
			 //      ? ConnectionStatus.Connecting
			 //      : ConnectionStatus.Disconnected);
			 //    Reconnect...
			})

			return new Promise(resolve => {
				peer.on("open", () => resolve(peer))
			})
		});

	}


	private handleCallEnd() {
		this.callArgs && this.callArgs.onCallEnd()
		this.callConnection[0] && this.callConnection[0].close()
		this.store.update({ calling: CallingState.NoCall })
		this.callArgs = null
		// TODO:  We have it separated, right? (check)
		//this.toggleAnnotation(false)
	}
	private onRemoteCallEnd = () => {
		if (this.store.get().calling === CallingState.Requesting) {
			this.callArgs && this.callArgs.onReject()
			this.callConnection[0] && this.callConnection[0].close()
			this.store.update({ calling: CallingState.NoCall })
			this.callArgs = null
			// TODO:  We have it separated, right? (check)
			//this.toggleAnnotation(false)
		} else {
			this.handleCallEnd()
		}
	}

	initiateCallEnd = async () => {
		this.socket?.emit("call_end", appStore.getState().getIn([ 'user', 'account', 'name']))
		this.handleCallEnd()
		// TODO:  We have it separated, right? (check)
		// const remoteControl = this.store.get().remoteControl
		// if (remoteControl === RemoteControlStatus.Enabled) {
		//   this.socket.emit("release_control")
		//   this.toggleRemoteControl(false)
		// }
	}


	private callArgs: {
		localStream: LocalStream,
		onStream: (s: MediaStream)=>void,
		onCallEnd: () => void,
		onReject: () => void,
		onError?: ()=> void,
	} | null = null

	setCallArgs(
		localStream: LocalStream,
		onStream: (s: MediaStream)=>void,
		onCallEnd: () => void,
		onReject: () => void,
		onError?: (e?: any)=> void,
	) {
		this.callArgs = {
			localStream,
			onStream,
			onCallEnd,
			onReject,
			onError,
		}
	}

	call(thirdPartyPeers?: string[]): { end: () => void } {
		if (thirdPartyPeers && thirdPartyPeers.length > 0) {
			this.addPeerCall(thirdPartyPeers)
		} else {
			this._callSessionPeer()
		}
		return {
			end: this.initiateCallEnd,
		}
	}

	toggleVideoLocalStream(enabled: boolean) {
    this.getPeer().then((peer) => {
      this.socket.emit('videofeed', { streamId: peer.id, enabled })
    })
  }


	/** Connecting to the other agents that are already
	 *  in the call with the user
	 */
	addPeerCall(thirdPartyPeers: string[]) {
		thirdPartyPeers.forEach(peer => this._peerConnection(peer))
	}

	/** Connecting to the app user */
	private _callSessionPeer() {
		if (![CallingState.NoCall, CallingState.Reconnecting].includes(this.store.get().calling)) { return }
		this.store.update({ calling: CallingState.Connecting })
		this._peerConnection(this.peerID);
		this.socket.emit("_agent_name", appStore.getState().getIn([ 'user', 'account', 'name']))
	}

	private async _peerConnection(remotePeerId: string) {
		try {
			const peer = await this.getPeer();
			const call = peer.call(remotePeerId, this.callArgs.localStream.stream)
			this.callConnection.push(call)

			this.callArgs.localStream.onVideoTrack(vTrack => {
				const sender = call.peerConnection.getSenders().find(s => s.track?.kind === "video")
				if (!sender) {
					console.warn("No video sender found")
					return
				}
				sender.replaceTrack(vTrack)
			})

			call.on('stream', stream => {
				this.store.get().calling !== CallingState.OnCall && this.store.update({ calling: CallingState.OnCall })

				this.videoStreams[call.peer] = stream.getVideoTracks()[0]

				this.callArgs && this.callArgs.onStream(stream)
			});
			// call.peerConnection.addEventListener("track", e => console.log('newtrack',e.track))

			call.on("close", this.onRemoteCallEnd)
			call.on("error", (e) => {
				console.error("PeerJS error (on call):", e)
				this.initiateCallEnd();
				this.callArgs && this.callArgs.onError && this.callArgs.onError();
			});
		} catch (e) {
			console.error(e)
		}
	}

	private cleaned: boolean = false
	clean() {
		this.cleaned = true // sometimes cleaned before modules loaded
		this.initiateCallEnd()
		if (this._peer) {
			console.log("destroying peer...")
			const peer = this._peer; // otherwise it calls reconnection on data chan close
			this._peer = null;
			peer.disconnect();
			peer.destroy();
		}
	}
}