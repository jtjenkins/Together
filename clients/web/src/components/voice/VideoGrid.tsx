import { VideoTile } from "./VideoTile";
import type { RemoteStreams } from "../../hooks/useWebRTC";
import styles from "./VideoGrid.module.css";

interface VideoGridProps {
  getRemoteStreams: () => Map<string, RemoteStreams>;
  streamVersion: number;
  localCameraStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localUserId: string;
  localUsername: string;
}

export function VideoGrid({
  getRemoteStreams,
  streamVersion: _streamVersion,
  localCameraStream,
  localScreenStream,
  localUserId,
  localUsername,
}: VideoGridProps) {
  const remoteStreams = getRemoteStreams();

  const tiles: Array<{
    key: string;
    stream: MediaStream;
    username: string;
    isLocal: boolean;
    isScreen: boolean;
  }> = [];

  if (localCameraStream) {
    tiles.push({
      key: `${localUserId}-camera`,
      stream: localCameraStream,
      username: localUsername,
      isLocal: true,
      isScreen: false,
    });
  }

  if (localScreenStream) {
    tiles.push({
      key: `${localUserId}-screen`,
      stream: localScreenStream,
      username: localUsername,
      isLocal: true,
      isScreen: true,
    });
  }

  remoteStreams.forEach((rs, userId) => {
    if (rs.camera) {
      tiles.push({
        key: `${userId}-camera`,
        stream: rs.camera,
        username: rs.username,
        isLocal: false,
        isScreen: false,
      });
    }
    if (rs.screen) {
      tiles.push({
        key: `${userId}-screen`,
        stream: rs.screen,
        username: rs.username,
        isLocal: false,
        isScreen: true,
      });
    }
  });

  if (tiles.length === 0) return null;

  return (
    <div className={styles.grid}>
      {tiles.map((t) => (
        <VideoTile
          key={t.key}
          stream={t.stream}
          username={t.username}
          isLocal={t.isLocal}
          isScreen={t.isScreen}
        />
      ))}
    </div>
  );
}
