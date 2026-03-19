import { useEffect, useRef, useState } from "react";
import { X, Maximize2, PictureInPicture2, Users } from "lucide-react";
import type { GoLiveQuality, GoLiveSession } from "../../types";
import styles from "./GoLiveViewer.module.css";

// ─── Quality selector ─────────────────────────────────────────────────────────

interface QualitySelectorProps {
  onSelect: (quality: GoLiveQuality) => void;
  onCancel: () => void;
}

export function GoLiveQualitySelector({
  onSelect,
  onCancel,
}: QualitySelectorProps) {
  const qualities: GoLiveQuality[] = ["480p", "720p", "1080p"];

  return (
    <div className={styles.qualityMenu}>
      <p className={styles.qualityTitle}>Select stream quality</p>
      <div className={styles.qualityOptions}>
        {qualities.map((q) => (
          <button
            key={q}
            className={styles.qualityOption}
            onClick={() => onSelect(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <p className={styles.qualityHint}>
        Higher quality uses more bandwidth for viewers.
      </p>

      <button className={styles.qualityCancelBtn} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// ─── In-channel banner ────────────────────────────────────────────────────────

interface GoLiveBannerProps {
  session: GoLiveSession;
  broadcasterName: string;
  viewerCount: number;
  onWatch: () => void;
}

export function GoLiveBanner({
  session,
  broadcasterName,
  viewerCount,
  onWatch,
}: GoLiveBannerProps) {
  return (
    <div className={styles.banner} onClick={onWatch}>
      <span className={styles.bannerLive}>
        <span className={styles.bannerDot} />
        Live
      </span>
      <span className={styles.bannerText}>
        {broadcasterName} is streaming · {session.quality}
      </span>
      <span className={styles.viewerCount}>
        <Users size={12} />
        {viewerCount}
      </span>
      <button className={styles.watchBtn}>Watch</button>
    </div>
  );
}

// ─── Full viewer overlay ──────────────────────────────────────────────────────

interface GoLiveViewerProps {
  stream: MediaStream;
  session: GoLiveSession;
  broadcasterName: string;
  viewerCount: number;
  onClose: () => void;
}

export function GoLiveViewer({
  stream,
  session,
  broadcasterName,
  viewerCount,
  onClose,
}: GoLiveViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPip, setIsPip] = useState(false);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream]);

  // Sync PiP state with browser events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  const handleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      video.requestFullscreen().catch(() => {});
    }
  };

  const handlePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn("[GoLive] PiP not available", err);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot} />
          Live
        </span>
        <span className={styles.broadcasterName}>{broadcasterName}</span>
        <span className={styles.qualityBadge}>{session.quality}</span>
        <span className={styles.viewerCount}>
          <Users size={13} />
          {viewerCount}
        </span>
      </div>

      <div className={styles.videoWrapper}>
        <video
          ref={videoRef}
          className={styles.video}
          autoPlay
          playsInline
          muted={false}
        />
      </div>

      <div className={styles.actions}>
        {isPip && (
          <span className={styles.pipActive}>
            Playing in Picture-in-Picture
          </span>
        )}
        <button
          className={styles.iconBtn}
          onClick={handlePip}
          title="Picture-in-Picture"
          aria-label="Toggle Picture-in-Picture"
        >
          <PictureInPicture2 size={18} />
        </button>
        <button
          className={styles.iconBtn}
          onClick={handleFullscreen}
          title="Fullscreen"
          aria-label="Toggle fullscreen"
        >
          <Maximize2 size={18} />
        </button>
        <button
          className={`${styles.iconBtn} ${styles.closeBtn}`}
          onClick={onClose}
          title="Close viewer"
          aria-label="Close viewer"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
