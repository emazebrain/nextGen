/**
 * Platform admin → Appearance: the background every user sees. The standard theme background, a solid colour
 * (from the palette or a pasted hex code) or an uploaded image with a blur level. Nothing changes until Save.
 */
import { useEffect, useId, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import { ImageUp } from "lucide-react";
import { Alert, Button, Card, MazeLoader, PageHeader, Segmented, TextField } from "@emb/ui";
import { BLURS, HEX, IMAGE_MAX_BYTES, IMAGE_TYPES, prepareImage, useAdminAppearance, useSaveAppearance, type AdminAppearance, type AppearanceBlur, type AppearanceKind } from "../../api/appearance.ts";
import { useT, type MessageId } from "../../i18n/index.tsx";
import { useTitle } from "../../lib/title.ts";
import { LoadError } from "../shared.tsx";
import { saveError } from "./common.tsx";

/** Calm colours that suit a children's clinic; the last two are dark. */
export const PALETTE: Array<{ id: string; hex: string }> = [
  { id: "cream", hex: "#f6ebdd" },
  { id: "sand", hex: "#e9d5c0" },
  { id: "peach", hex: "#f7d9c4" },
  { id: "blush", hex: "#f3d6dc" },
  { id: "lavender", hex: "#ddd6f7" },
  { id: "periwinkle", hex: "#cfd8f6" },
  { id: "sky", hex: "#cfe6f3" },
  { id: "aqua", hex: "#c9ebe6" },
  { id: "mint", hex: "#d3ecd5" },
  { id: "sage", hex: "#c7d6c3" },
  { id: "slate", hex: "#2b3147" },
  { id: "plum", hex: "#2a2550" },
];

/** "#E9D5C0", "e9d5c0" or " #e9d5c0 " → "#e9d5c0"; null when it isn't six hex digits. */
export function normalizeHex(input: string): string | null {
  const v = input.trim().toLowerCase();
  const hex = v.startsWith("#") ? v : `#${v}`;
  return HEX.test(hex) ? hex : null;
}

export function AppearancePage() {
  const t = useT();
  useTitle(t("admin.appearance.title"));
  const saved = useAdminAppearance();
  return (
    <div className="app-page">
      <PageHeader title={t("admin.appearance.title")} description={t("admin.appearance.description")} />
      {saved.isPending ? <MazeLoader label={t("common.loading")} /> : saved.isError ? <LoadError error={saved.error} retry={() => void saved.refetch()} /> : <AppearanceForm saved={saved.data} />}
    </div>
  );
}

function AppearanceForm({ saved }: { saved: AdminAppearance }) {
  const t = useT();
  const save = useSaveAppearance();
  const fileId = useId();
  const [kind, setKind] = useState<AppearanceKind>(saved.kind);
  const [hexText, setHexText] = useState(saved.color ?? PALETTE[0]!.hex);
  const [blur, setBlur] = useState<AppearanceBlur>(saved.blur);
  const [image, setImage] = useState<Blob | null>(null);
  const [error, setError] = useState<MessageId | null>(null);
  const [done, setDone] = useState(false);

  const hex = normalizeHex(hexText);
  // A local address for previewing the chosen file (some embedded browsers can't make one; the preview is then skipped).
  const picked = useMemo(() => (image && typeof URL.createObjectURL === "function" ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => () => void (picked && URL.revokeObjectURL(picked)), [picked]);
  // The image on file, addressed by the saved version so the browser never shows an older one.
  const imageUrl = picked ?? (saved.has_image ? (saved.image_url ?? `/api/appearance/image?v=${saved.version}`) : null);
  // While another kind is active the stored image isn't served, so there is nothing to preview until it is saved.
  const canPreviewImage = picked !== null || saved.kind === "image";

  const touch = () => {
    setError(null);
    setDone(false);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    touch();
    if (!IMAGE_TYPES.includes(file.type)) return setError("admin.appearance.imageUnsupported");
    const ready = await prepareImage(file);
    if (ready.size > IMAGE_MAX_BYTES) return setError("admin.appearance.imageTooLarge");
    setImage(ready);
  };

  const submit = async () => {
    touch();
    if (kind === "color" && !hex) return setError("admin.appearance.hexInvalid");
    if (kind === "image" && !image && !saved.has_image) return setError("admin.appearance.noImage");
    try {
      await save.mutateAsync(kind === "default" ? { kind } : kind === "color" ? { kind, color: hex!, blur } : { kind, blur, ...(image ? { image } : {}) });
      setImage(null);
      setDone(true);
    } catch (err) {
      setError(saveError(err));
    }
  };

  const previewStyle: CSSProperties = kind === "color" && hex ? { backgroundColor: hex } : kind === "image" && imageUrl && canPreviewImage ? { backgroundImage: `url("${imageUrl}")` } : {};

  return (
    <div className="appearance">
      <Card as="section" labelledBy="appearance-bg">
        <h2 id="appearance-bg" className="app-cardtitle">
          {t("admin.appearance.background")}
        </h2>
        <div className="pform">
          {error && <Alert tone="danger">{t(error)}</Alert>}
          {done && <Alert tone="success">{t("admin.appearance.saved")}</Alert>}

          <Segmented<AppearanceKind>
            legend={t("admin.appearance.kind")}
            name="appearance-kind"
            value={kind}
            onChange={(k) => {
              setKind(k);
              touch();
            }}
            options={[
              { value: "default", label: t("admin.appearance.kind.default") },
              { value: "color", label: t("admin.appearance.kind.color") },
              { value: "image", label: t("admin.appearance.kind.image") },
            ]}
          />

          {kind === "default" && <p className="app-muted">{t("admin.appearance.defaultHint")}</p>}

          {kind === "color" && (
            <>
              <fieldset className="swatches">
                <legend className="emb-field__label">{t("admin.appearance.palette")}</legend>
                <div className="swatches__grid">
                  {PALETTE.map((c) => (
                    <label key={c.id} className="swatch" title={t(`admin.appearance.swatch.${c.id}` as MessageId)}>
                      <input
                        type="radio"
                        name="appearance-swatch"
                        value={c.hex}
                        checked={hex === c.hex}
                        aria-label={t(`admin.appearance.swatch.${c.id}` as MessageId)}
                        onChange={() => {
                          setHexText(c.hex);
                          touch();
                        }}
                      />
                      <span className="swatch__chip" style={{ backgroundColor: c.hex }} />
                    </label>
                  ))}
                </div>
              </fieldset>
              <TextField
                label={t("admin.appearance.hex")}
                hint={t("admin.appearance.hexHint")}
                value={hexText}
                dir="ltr"
                inputMode="text"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={9}
                className="appearance__hex"
                onChange={(e) => {
                  setHexText(e.target.value);
                  touch();
                }}
              />
            </>
          )}

          {kind === "image" && (
            <>
              <div className="appearance__upload">
                <input id={fileId} type="file" accept={IMAGE_TYPES.join(",")} className="appearance__file" aria-label={t("admin.appearance.upload")} onChange={(e) => void onFile(e)} />
                <label htmlFor={fileId} className="emb-btn emb-btn--secondary">
                  <ImageUp size={18} aria-hidden="true" />
                  <span>{t(image || saved.has_image ? "admin.appearance.replace" : "admin.appearance.upload")}</span>
                </label>
                {image && <span className="app-muted">{t("admin.appearance.imageReady")}</span>}
              </div>
              <p className="app-muted">{t("admin.appearance.imageHint")}</p>
              <Segmented<AppearanceBlur>
                legend={t("admin.appearance.blur")}
                name="appearance-blur"
                value={blur}
                onChange={(b) => {
                  setBlur(b);
                  touch();
                }}
                options={BLURS.map((b) => ({ value: b, label: t(`admin.appearance.blur.${b}` as MessageId) }))}
              />
            </>
          )}

          <div className="pform__actions">
            <Button onClick={() => void submit()} loading={save.isPending}>
              {t("admin.appearance.save")}
            </Button>
          </div>
        </div>
      </Card>

      <Card as="section" labelledBy="appearance-preview">
        <h2 id="appearance-preview" className="app-cardtitle">
          {t("admin.appearance.preview")}
        </h2>
        <div className="appearance__preview">
          <div className="appearance__previewbg" data-blur={kind === "image" ? blur : "none"} style={previewStyle} />
          <div className="appearance__previewveil">
            <div className="appearance__previewcard">{t("admin.appearance.previewCard")}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
