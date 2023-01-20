import React from 'react';
import cn from 'classnames';
import { avatarIconName } from 'App/iconNames';
import stl from './avatar.module.css';
import { Icon, Tooltip } from 'UI';

const Avatar = ({
  isActive = false,
  isAssist = false,
  width = '38px',
  height = '38px',
  iconSize = 26,
  seed,
}) => {
  var iconName = avatarIconName(seed);
  return (
    <Tooltip title={isActive ? 'Active user' : 'User might be inactive'} disabled={!isAssist}>
      <div
        className={cn(
          stl.wrapper,
          'p-2 border flex items-center justify-center rounded-full relative'
        )}
        style={{ width, height }}
      >
        <Icon name={iconName} size={iconSize} color="tealx" />
        {isAssist && (
          <div
            className={cn('w-2 h-2 rounded-full absolute right-0 bottom-0', {
              'bg-green': isActive,
              'bg-orange': !isActive,
            })}
            style={{ marginRight: '3px', marginBottom: '3px' }}
          />
        )}
      </div>
    </Tooltip>
  );
};

export default Avatar;
