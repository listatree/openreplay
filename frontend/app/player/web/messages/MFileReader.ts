import type { Message } from './message.gen';
import type { RawMessage } from './raw.gen';
import { MType } from './raw.gen';
import RawMessageReader from './RawMessageReader.gen';
import resolveURL from './urlBasedResolver'


// TODO: composition instead of inheritance
// needSkipMessage() and next() methods here use buf and p protected properties,
// which should be probably somehow incapsulated
export default class MFileReader extends RawMessageReader {
  private pLastMessageID: number = 0
  private currentTime: number
  public error: boolean = false
  constructor(data: Uint8Array, private startTime?: number, private logger=console) {
    super(data)
  }

  private needSkipMessage(): boolean {
    if (this.p === 0) return false
    for (let i = 7; i >= 0; i--) {
      if (this.buf[ this.p + i ] !== this.buf[ this.pLastMessageID + i ]) {
        return this.buf[ this.p + i ] < this.buf[ this.pLastMessageID + i ]
      }
    }
    return false
  }

  private getLastMessageID(): number {
    let id = 0
    for (let i = 0; i< 8; i++) {
      id += this.buf[ this.p + i ] * 2**(8*i)
    }
    return id
  }

  private readRawMessage(): RawMessage | null {
    this.skip(8)
    try {
      const msg = super.readMessage()
      if (!msg) {
        this.skip(-8)
      }
      return msg
    } catch (e) {
      this.error = true
      this.logger.error("Read message error:", e)
      return null
    }
  }

  readNext(): Message & { _index: number } | null {
    if (this.error || !this.hasNextByte()) {
      return null
    }

    while (this.needSkipMessage()) {
      const skippedMessage = this.readRawMessage()
      if (!skippedMessage) {
        return null
      }
      this.logger.group("Openreplay: Skipping messages ", skippedMessage)

    }

    this.pLastMessageID = this.p

    const rMsg = this.readRawMessage()
    if (!rMsg) {
      return null
    }

    if (rMsg.tp === MType.Timestamp) {
      if (!this.startTime) {
        this.startTime = rMsg.timestamp
      }
      this.currentTime = rMsg.timestamp - this.startTime
      return this.readNext()
    }

    const index = this.getLastMessageID()
    const msg = Object.assign(resolveURL(rMsg), {
      time: this.currentTime,
      _index: index,
    })

    return msg
  }
}
