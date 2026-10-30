import React, { useEffect, useRef, useState } from 'react';

type ShimmerImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  wrapperClassName?: string;
};

const paintedSources = new Set<string>();

/**
 * React equivalent of an Angular attribute directive on `<img>`.
 * Keeps a shimmer skeleton over the image until it has painted.
 */
export const ShimmerImage: React.FC<ShimmerImageProps> = ({
  src,
  alt = '',
  className = '',
  wrapperClassName = '',
  onLoad,
  onError,
  ...imgProps
}) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(() => Boolean(src && paintedSources.has(src)));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (src && paintedSources.has(src)) {
      setLoaded(true);
      setFailed(false);
      return;
    }
    setLoaded(false);
    setFailed(false);
  }, [src]);

  useEffect(() => {
    const image = imageRef.current;
    if (image && image.complete && image.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  const showShimmer = !src || (!loaded && !failed);

  return (
    <div className={`relative w-full h-full overflow-hidden ${wrapperClassName}`}>
      {showShimmer && <div className="image-shimmer" aria-hidden="true" />}
      {src ? (
        <img
          {...imgProps}
          ref={imageRef}
          src={src}
          alt={alt}
          onLoad={(event) => {
            if (src) paintedSources.add(src);
            setLoaded(true);
            onLoad?.(event);
          }}
          onError={(event) => {
            setFailed(true);
            onError?.(event);
          }}
          className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        />
      ) : null}
    </div>
  );
};
