"use client";

import { CircleAlertIcon, CircleCheckIcon, CopyIcon, FileUpIcon, UploadIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { ApiErrorBody, UploadItem } from "@/lib/api-types";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 2;

type Entry = {
  key: string;
  file: File;
  state: "ready" | "uploading" | "queued" | "duplicate" | "error";
  progress: number;
  message: string | null;
};

function validate(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Not a PDF. Only PDF files can be indexed.";
  if (file.size > MAX_BYTES) return `${formatBytes(file.size)} is over the 50 MB limit.`;
  if (file.size === 0) return "This file is empty.";
  return null;
}

/** One multipart POST per file through the BFF, with upload progress (fetch can't report it). */
function uploadFile(url: string, file: File, onProgress: (pct: number) => void): Promise<Pick<Entry, "state" | "message">> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("files[]", file, file.name);
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const body = xhr.response as ({ documents?: UploadItem[] } & ApiErrorBody) | null;
      if (xhr.status >= 200 && xhr.status < 300) {
        const item = body?.documents?.[0];
        resolve(
          item?.status === "queued"
            ? { state: "queued", message: "Uploaded. Indexing has started." }
            : { state: "error", message: item?.message ?? "The upload was not accepted." },
        );
      } else if (xhr.status === 409) {
        resolve({ state: "duplicate", message: "Already uploaded. This exact PDF is in the library." });
      } else if (xhr.status === 401) {
        resolve({ state: "error", message: "Your session expired. Sign in again and retry." });
      } else {
        resolve({ state: "error", message: body?.error?.message ?? `Upload failed (${xhr.status}).` });
      }
    };
    xhr.onerror = () => resolve({ state: "error", message: "The connection dropped. Try again." });
    xhr.send(form);
  });
}

export function UploadDialog({ orgId, onUploaded }: { orgId: string; onUploaded: () => void }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  function add(files: FileList | File[]) {
    const next = [...files].map<Entry>((file) => {
      const problem = validate(file);
      return {
        key: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
        file,
        state: problem ? "error" : "ready",
        progress: 0,
        message: problem,
      };
    });
    setEntries((prev) => [...prev, ...next]);
  }

  function update(key: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  async function start() {
    const queue = entries.filter((e) => e.state === "ready");
    if (!queue.length) return;
    setRunning(true);
    const url = `/api/backend/orgs/${encodeURIComponent(orgId)}/documents`;
    let accepted = 0;
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const key = entry.key;
        update(key, { state: "uploading", progress: 0 });
        const result = await uploadFile(url, entry.file, (progress) => update(key, { progress }));
        if (result.state === "queued") accepted += 1;
        update(key, { ...result, progress: 100 });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
    if (accepted) onUploaded();
  }

  const ready = entries.filter((e) => e.state === "ready").length;
  const finished = entries.length > 0 && entries.every((e) => e.state !== "ready" && e.state !== "uploading");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return; // keep the dialog while files are in flight
        setOpen(next);
        if (!next) setEntries([]);
      }}
    >
      <DialogTrigger render={<Button />}>
        <UploadIcon data-icon="inline-start" />
        Upload PDFs
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload policy PDFs</DialogTitle>
          <DialogDescription>
            Each PDF is read, classified and indexed in a minute or two. Up to 50 MB per file.
          </DialogDescription>
        </DialogHeader>

        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) add(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
            "hover:border-ring/60 hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
            dragging && "border-ring bg-accent",
          )}
        >
          <FileUpIcon className="size-6 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">Drop PDFs here, or choose files</span>
          <span className="text-xs text-muted-foreground">Several at once is fine.</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            disabled={running}
            onChange={(e) => {
              if (e.target.files?.length) add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        {entries.length > 0 && (
          <ul className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border" aria-label="Files to upload">
            {entries.map((entry) => (
              <li key={entry.key} className="flex items-start gap-3 px-3 py-2.5">
                <EntryIcon state={entry.state} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{entry.file.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(entry.file.size)}</span>
                  </div>
                  {entry.state === "uploading" ? (
                    <Progress value={entry.progress} aria-label={`Uploading ${entry.file.name}`} className="gap-0" />
                  ) : (
                    entry.message && (
                      <span
                        className={cn(
                          "text-xs",
                          entry.state === "error" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {entry.message}
                      </span>
                    )
                  )}
                </div>
                {(entry.state === "ready" || entry.state === "error") && !running && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${entry.file.name}`}
                    onClick={() => setEntries((prev) => prev.filter((e) => e.key !== entry.key))}
                  >
                    <XIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {finished ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button onClick={start} disabled={!ready || running}>
              {running ? "Uploading…" : ready ? `Upload ${ready} file${ready === 1 ? "" : "s"}` : "Upload"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryIcon({ state }: { state: Entry["state"] }) {
  const base = "mt-0.5 size-4 shrink-0";
  if (state === "queued") return <CircleCheckIcon className={cn(base, "text-success")} aria-label="Uploaded" />;
  if (state === "duplicate") return <CopyIcon className={cn(base, "text-muted-foreground")} aria-label="Already uploaded" />;
  if (state === "error") return <CircleAlertIcon className={cn(base, "text-destructive")} aria-label="Problem" />;
  return <FileUpIcon className={cn(base, "text-muted-foreground")} aria-hidden />;
}
