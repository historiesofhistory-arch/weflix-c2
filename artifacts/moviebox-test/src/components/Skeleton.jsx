import React from 'react';
import PropTypes from 'prop-types';

export default function Skeleton({
  width,
  height,
  className = '',
  rounded = 'rounded-md',
  circle = false,
  as: Tag = 'div',
  style: styleOverride,
  ...rest
}) {
  const style = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    ...styleOverride,
  };
  return (
    <Tag
      aria-hidden="true"
      style={style}
      className={`bg-white/[0.06] animate-pulse ${circle ? 'rounded-full' : rounded} ${className}`}
      {...rest}
    />
  );
}

Skeleton.propTypes = {
  width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  height: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  className: PropTypes.string,
  rounded: PropTypes.string,
  circle: PropTypes.bool,
  as: PropTypes.elementType,
  style: PropTypes.object,
};
