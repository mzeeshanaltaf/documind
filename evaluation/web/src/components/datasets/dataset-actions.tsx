"use client";

import { FilePlusIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { createDataset, createDraft, pinDataset, publishVersion, updateDataset } from "@/app/(app)/datasets/actions";
import { OptionSelect } from "@/components/app/option-select";
import { FormAlert } from "@/components/auth/form-alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DATASET_KINDS, type DatasetKind, type DatasetOut } from "@/lib/api-types";
import { humanize } from "@/lib/format";

/** Create a dataset (slug fixed forever) or edit one (name, description, default org, kind, archived). */
export function DatasetDialog({ dataset }: { dataset?: DatasetOut }) {
  const uid = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(dataset?.slug ?? "");
  const [name, setName] = useState(dataset?.name ?? "");
  const [description, setDescription] = useState(dataset?.description ?? "");
  const [org, setOrg] = useState(dataset?.default_org_slug ?? "");
  const [kind, setKind] = useState<DatasetKind>(dataset?.kind ?? "mixed");
  const [archived, setArchived] = useState(!!dataset?.archived_at);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const fields = { name, description, default_org_slug: org, kind };
      const result = dataset
        ? await updateDataset(dataset.id, { ...fields, archived })
        : await createDataset({ ...fields, slug: slug.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      toast.success(dataset ? "Dataset saved." : `Created ${result.data.name} with an empty draft v1.`);
      if (!dataset) router.push(`/datasets/${result.data.id}/v/1`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={dataset ? "outline" : "default"} />}>
        {dataset ? <PencilIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
        {dataset ? "Edit" : "New dataset"}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{dataset ? "Edit dataset" : "New dataset"}</DialogTitle>
            <DialogDescription>
              {dataset ? "Cases live in versions; edit them on a draft." : "It starts with an empty draft v1 to add cases to."}
            </DialogDescription>
          </DialogHeader>
          <FormAlert message={error} />
          <FieldGroup className="gap-4">
            {!dataset && (
              <Field>
                <FieldLabel htmlFor={`${uid}-slug`}>Slug</FieldLabel>
                <Input id={`${uid}-slug`} value={slug} onChange={(e) => setSlug(e.target.value)} className="font-mono" placeholder="adversarial" />
                <FieldDescription>Lowercase letters, digits and hyphens. It can&apos;t change later.</FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
              <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${uid}-description`}>Description</FieldLabel>
              <Textarea id={`${uid}-description`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${uid}-org`}>Default org</FieldLabel>
                <Input id={`${uid}-org`} value={org} onChange={(e) => setOrg(e.target.value)} className="font-mono" placeholder="simtora" />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${uid}-kind`}>Kind</FieldLabel>
                <OptionSelect
                  id={`${uid}-kind`}
                  value={kind}
                  onValueChange={(v) => setKind(v as DatasetKind)}
                  options={DATASET_KINDS.map((k) => ({ value: k, label: humanize(k) }))}
                  className="w-full"
                />
              </Field>
            </div>
            {dataset && (
              <Field orientation="horizontal">
                <Switch id={`${uid}-archived`} checked={archived} onCheckedChange={setArchived} />
                <FieldContent>
                  <FieldLabel htmlFor={`${uid}-archived`}>Archived</FieldLabel>
                  <FieldDescription>Hidden from the datasets list; its runs stay.</FieldDescription>
                </FieldContent>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              {dataset ? "Save" : "Create dataset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PinButton({ datasetId, pinned }: { datasetId: string; pinned: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await pinDataset(pinned ? null : datasetId);
          if (!result.ok) toast.error(result.error);
          else toast.success(pinned ? "Unpinned from the dashboard." : "Pinned: the dashboard shows this dataset's trends.");
        })
      }
    >
      {pinned ? <PinOffIcon data-icon="inline-start" /> : <PinIcon data-icon="inline-start" />}
      {pinned ? "Unpin" : "Pin to dashboard"}
    </Button>
  );
}

/** Copies the latest version into a new draft (one draft at a time). */
export function NewDraftButton({ datasetId, datasetPath }: { datasetId: string; datasetPath: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createDraft(datasetId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`Draft v${result.data.version} created from the latest version.`);
          router.push(`${datasetPath}/v/${result.data.version}`);
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : <FilePlusIcon data-icon="inline-start" />}
      New draft
    </Button>
  );
}

export function PublishButton({ versionId, version, cases }: { versionId: string; version: number; cases: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button disabled={cases === 0} />}>
        <SendIcon data-icon="inline-start" />
        Publish
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish v{version}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its {cases} cases are frozen and hashed, so runs on it stay comparable. Later edits go into a new draft.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await publishVersion(versionId);
                setOpen(false);
                if (!result.ok) toast.error(result.error);
                else toast.success(`v${version} published.`);
              })
            }
          >
            {pending && <Spinner data-icon="inline-start" />}
            Publish
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
