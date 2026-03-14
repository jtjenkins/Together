import { useEffect, useRef } from "react";
import styles from "./VideoTile.module.css";

interface VideoTileProps {
  stream: MediaStream;
  username: string;
  isLocal: boolean;
  isScreen: boolean;
}

export function VideoTile({
  stream,
  username,
  isLocal,
  isScreen,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={styles.tile}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={styles.video}
      />
      <div className={styles.overlay}>
        <span className={styles.username}>{username}</span>
        {isScreen && <span className={styles.badge}>Screen</span>}
      </div>
    </div>
  );
}
