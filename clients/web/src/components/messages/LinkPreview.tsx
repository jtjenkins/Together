import React, { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { LinkPreviewDto } from "../../types";
import styles from "./LinkPreview.module.css";

interface LinkPreviewProps {
  url: string;
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<LinkPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getLinkPreview(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return <div className={styles.skeleton} />;
  }

  if (!data?.title) {
    return null;
  }

  return (
    <div className={styles.card}>
      {data.site_name && (
        <div className={styles.siteName} data-testid="site-name">
          {data.site_name}
        </div>
      )}
      <a href={url} target="_blank" rel="noreferrer" className={styles.title}>
        {data.title}
      </a>
      {data.description && (
        <div className={styles.description}>{data.description}</div>
      )}
      {data.image && (
        <img
          src={data.image}
          alt={data.title ?? "Link preview"}
          className={styles.thumbnail}
        />
      )}
    </div>
  );
}
