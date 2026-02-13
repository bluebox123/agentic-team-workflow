import { ArtifactType } from "./types";

export const ArtifactDefaults: Record<
  ArtifactType,
  { mime_type: string; previewable: boolean }
> = {
  pdf: {
    mime_type: "application/pdf",
    previewable: true,
  },
  image: {
    mime_type: "image/png",
    previewable: true,
  },
  chart: {
    mime_type: "image/png",
    previewable: true,
  },
  table: {
    mime_type: "text/csv",
    previewable: false,
  },
  json: {
    mime_type: "application/json",
    previewable: false,
  },
  text: {
    mime_type: "text/plain",
    previewable: false,
  },
};
