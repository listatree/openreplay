import React from 'react';
import { useEffect, useState } from 'react';
import { connect } from 'react-redux';
import withRequest from 'HOCs/withRequest';
import withPermissions from 'HOCs/withPermissions';
import { PlayerContext, defaultContextValue, ILivePlayerContext } from './playerContext';
import { makeAutoObservable } from 'mobx';
import { createLiveWebPlayer } from 'Player';
import PlayerBlockHeader from './Player/LivePlayer/LivePlayerBlockHeader';
import PlayerBlock from './Player/LivePlayer/LivePlayerBlock';
import styles from '../Session_/session.module.css';
import Session from 'App/mstore/types/session';
import withLocationHandlers from 'HOCs/withLocationHandlers';

interface Props {
  session: Session;
  loadingCredentials: boolean;
  assistCredentials: RTCIceServer[];
  isEnterprise: boolean;
  userEmail: string;
  userName: string;
  customSession?: Session;
  isMultiview?: boolean;
  query?: Record<string, (key: string) => any>;
  request: () => void;
}

function LivePlayer({
  session,
  loadingCredentials,
  assistCredentials,
  request,
  isEnterprise,
  userEmail,
  userName,
  isMultiview,
  customSession,
  query
}: Props) {
  // @ts-ignore
  const [contextValue, setContextValue] = useState<ILivePlayerContext>(defaultContextValue);
  const [fullView, setFullView] = useState(false);
  const openedFromMultiview = query?.get('multi') === 'true'
  const usedSession = isMultiview ? customSession! : session;

  useEffect(() => {
    if (loadingCredentials || !usedSession.sessionId) return;
    const sessionWithAgentData = {
      ...usedSession,
      agentInfo: {
        email: userEmail,
        name: userName,
      },
    };
    const [player, store] = createLiveWebPlayer(sessionWithAgentData, assistCredentials, (state) =>
      makeAutoObservable(state)
    );
    setContextValue({ player, store });

    return () => player.clean();
  }, [session.sessionId, assistCredentials]);

  // LAYOUT (TODO: local layout state - useContext or something..)
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    if (
      (queryParams.has('fullScreen') && queryParams.get('fullScreen') === 'true') ||
      location.pathname.includes('multiview')
    ) {
      setFullView(true);
    }

    if (isEnterprise) {
      request();
    }
  }, []);

  if (!contextValue.player) return null;

  return (
    <PlayerContext.Provider value={contextValue}>
      {!fullView && (
        <PlayerBlockHeader
          // @ts-ignore
          isMultiview={openedFromMultiview}
        />
      )}
      <div
        className={styles.session}
        style={{
          height: isMultiview ? '100%' : undefined,
          width: isMultiview ? '100%' : undefined,
        }}
      >
        <PlayerBlock isMultiview={isMultiview} />
      </div>
    </PlayerContext.Provider>
  );
}

export default withRequest({
  initialData: null,
  endpoint: '/assist/credentials',
  dataName: 'assistCredentials',
  loadingName: 'loadingCredentials',
})(
  withPermissions(
    ['ASSIST_LIVE'],
    '',
    true
  )(
    connect(
      (state: any) => {
        return {
          session: state.getIn(['sessions', 'current']),
          showAssist: state.getIn(['sessions', 'showChatWindow']),
          isEnterprise: state.getIn(['user', 'account', 'edition']) === 'ee',
          userEmail: state.getIn(['user', 'account', 'email']),
          userName: state.getIn(['user', 'account', 'name']),
        };
      }
    )(withLocationHandlers()(LivePlayer))
  )
);
