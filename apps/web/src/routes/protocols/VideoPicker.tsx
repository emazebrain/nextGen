/** Choosing a video for a protocol step (ADR 0018): filter the published library by brain region and words. */
import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { Button, MazeLoader, TextField } from "@emb/ui";
import type { VideoSummary } from "@emb/contracts";
import { useBrainRegions, useVideos } from "../../api/queries.ts";
import { usePrefs, useT } from "../../i18n/index.tsx";
import { RegionFilter, regionParams, useRegionTree, type RegionChoice } from "../admin/RegionPicker.tsx";
import { formatDuration, VideoRegionChips, VideoSourceChip } from "../admin/videos.tsx";
import { LoadError } from "../shared.tsx";

export function VideoPicker({ onPick, onCancel }: { onPick: (v: VideoSummary) => void; onCancel: () => void }) {
  const t = useT();
  const { locale } = usePrefs();
  const [q, setQ] = useState("");
  const [region, setRegion] = useState<RegionChoice>(null);
  const regions = useBrainRegions(locale);
  const tree = useRegionTree(regions.data);
  const videos = useVideos({ lang: locale, q, ...regionParams(region) });
  return (
    <div className="gamepick videopick" role="group" aria-label={t("videoPicker.title")}>
      <p className="emb-field__label">{t("videoPicker.title")}</p>
      <div className="videopick__filters">
        <TextField label={t("videoPicker.search")} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        {regions.data && <RegionFilter tree={tree} value={region} onChange={setRegion} />}
      </div>
      {videos.isPending ? (
        <MazeLoader label={t("common.loading")} />
      ) : videos.isError ? (
        <LoadError error={videos.error} retry={() => void videos.refetch()} />
      ) : videos.data.length === 0 ? (
        <p className="app-muted" role="status">
          {t("videoPicker.none")}
        </p>
      ) : (
        <ul className="plainlist" aria-live="polite">
          {videos.data.map((v) => (
            <li key={v.id}>
              <button type="button" className="gamepick__item" onClick={() => onPick(v)}>
                <PlayCircle size={20} aria-hidden="true" />
                <span>
                  <span className="step__name">{v.title}</span>
                  <span className="app-muted gamepick__summary">
                    {[formatDuration(v.duration_s), v.age_min || v.age_max ? t("videoPicker.ages", { from: v.age_min ?? 3, to: v.age_max ?? 18 }) : null].filter(Boolean).join(" · ")}
                  </span>
                  <span className="videopick__chips">
                    <VideoSourceChip video={v} />
                    <VideoRegionChips video={v} max={3} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
