"use client";

import {
  EyeIcon,
  FileTextIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SearchXIcon,
  Trash2Icon,
} from "lucide-react";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { deleteDocument, reindexDocument } from "@/app/(app)/app/[orgSlug]/documents/actions";
import { type Option, OptionSelect } from "@/components/app/option-select";
import { PdfViewerProvider, usePdfViewer } from "@/components/pdf/pdf-viewer-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type DocumentRow, isInFlight, isSearchable } from "@/lib/api-types";
import { formatDate, jurisdictionName } from "@/lib/format";
import { DocumentDetailSheet } from "./document-detail-sheet";
import { DocumentStatus } from "./document-status";
import { EditMetadataSheet } from "./edit-metadata-sheet";
import { UploadDialog } from "./upload-dialog";

type Props = {
  orgId: string;
  orgSlug: string;
  orgName: string;
  canManage: boolean;
  initialDocuments: DocumentRow[];
};

type ListResponse = { documents: DocumentRow[] };

const ALL = "all";
const STATUS_OPTIONS: Option[] = [
  { value: ALL, label: "Any status" },
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

async function fetchList(url: string): Promise<ListResponse> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as ListResponse;
}

function statusKey(doc: DocumentRow) {
  if (isInFlight(doc)) return "processing";
  return doc.status === "failed" ? "failed" : "ready";
}

export function DocumentsView(props: Props) {
  return (
    <PdfViewerProvider orgId={props.orgId}>
      <DocumentsTable {...props} />
    </PdfViewerProvider>
  );
}

function DocumentsTable({ orgId, orgSlug, orgName, canManage, initialDocuments }: Props) {
  const { openDocument } = usePdfViewer();
  const { data, mutate } = useSWR<ListResponse>(`/api/backend/orgs/${encodeURIComponent(orgId)}/documents`, fetchList, {
    fallbackData: { documents: initialDocuments },
    revalidateOnMount: false,
    // Poll every 2 s while anything is uploading or indexing; stop once all settle.
    refreshInterval: (latest) => (canManage && latest?.documents.some(isInFlight) ? 2000 : 0),
  });
  const all = useMemo(() => {
    const docs = data?.documents ?? initialDocuments;
    return canManage ? docs : docs.filter(isSearchable);
  }, [data, initialDocuments, canManage]);

  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const deferredQuery = useDeferredValue(query);

  const departmentOptions = useMemo<Option[]>(() => {
    const present = [...new Set(all.map((d) => d.department).filter((d): d is string => !!d))].sort();
    return [{ value: ALL, label: "All departments" }, ...present.map((d) => ({ value: d, label: d }))];
  }, [all]);

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return all
      .filter((d) => department === ALL || d.department === department)
      .filter((d) => status === ALL || statusKey(d) === status)
      .filter((d) => !q || d.title.toLowerCase().includes(q) || (d.doc_code ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.doc_code ?? a.title).localeCompare(b.doc_code ?? b.title));
  }, [all, department, status, deferredQuery]);

  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [details, setDetails] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => void mutate();
  const replace = (doc: DocumentRow) =>
    void mutate((current) => ({ documents: (current?.documents ?? []).map((d) => (d.id === doc.id ? { ...d, ...doc } : d)) }), {
      revalidate: false,
    });

  function view(doc: DocumentRow) {
    openDocument({ documentId: doc.id, title: doc.title, docCode: doc.doc_code, page: 1 });
  }

  function reindex(doc: DocumentRow) {
    startTransition(async () => {
      const result = await reindexDocument(orgSlug, doc.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Reindexing ${doc.doc_code ?? doc.title}.`);
      refresh();
    });
  }

  function remove(doc: DocumentRow) {
    startTransition(async () => {
      const result = await deleteDocument(orgSlug, doc.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDeleting(null);
      void mutate((current) => ({ documents: (current?.documents ?? []).filter((d) => d.id !== doc.id) }), { revalidate: false });
      toast.success(`${doc.doc_code ?? doc.title} deleted.`);
    });
  }

  const filtered = query || department !== ALL || status !== ALL;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search documents"
            placeholder="Search by title or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <OptionSelect aria-label="Filter by department" value={department} onValueChange={setDepartment} options={departmentOptions} />
        {canManage && <OptionSelect aria-label="Filter by status" value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />}
        {canManage && (
          <div className="ml-auto">
            <UploadDialog orgId={orgId} onUploaded={refresh} />
          </div>
        )}
      </div>

      {all.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>No documents yet</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? `Upload ${orgName}'s policy PDFs. Each one is indexed so answers can cite its sections and pages.`
                : `${orgName} hasn't added any documents yet. Ask your administrator to upload them.`}
            </EmptyDescription>
          </EmptyHeader>
          {canManage && (
            <EmptyContent>
              <UploadDialog orgId={orgId} onUploaded={refresh} />
            </EmptyContent>
          )}
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>No documents match</EmptyTitle>
            <EmptyDescription>Try another search, or clear the filters.</EmptyDescription>
          </EmptyHeader>
          {filtered && (
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setDepartment(ALL);
                  setStatus(ALL);
                }}
              >
                Clear filters
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden sm:table-cell">Jurisdiction</TableHead>
                <TableHead className="hidden lg:table-cell">Version</TableHead>
                <TableHead className="hidden lg:table-cell">Effective</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Pages</TableHead>
                {canManage && <TableHead>Status</TableHead>}
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((doc) => (
                <TableRow key={doc.id} data-document-id={doc.id}>
                  <TableCell className="max-w-0 min-w-48 sm:max-w-none">
                    <button
                      type="button"
                      onClick={() => setDetails(doc)}
                      className="flex max-w-full min-w-0 flex-col items-start rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="max-w-full truncate font-medium hover:underline">{doc.title}</span>
                      <span className="font-mono text-[0.7rem] text-muted-foreground">
                        {doc.doc_code ?? doc.file_name ?? "No code"}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{doc.department ?? "n/a"}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {doc.jurisdiction ? (
                      <Badge variant="outline" className="gap-1.5 font-normal">
                        <span className="font-mono text-[0.65rem] text-muted-foreground">{doc.jurisdiction}</span>
                        {jurisdictionName(doc.jurisdiction)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">n/a</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">{doc.version ?? "n/a"}</TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                    {formatDate(doc.effective_date)}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums xl:table-cell">
                    {doc.page_count ?? "n/a"}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <DocumentStatus doc={doc} />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${doc.title}`} />}
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => view(doc)} disabled={!isSearchable(doc) && doc.status !== "ready"}>
                            <EyeIcon />
                            View PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDetails(doc)}>
                            <InfoIcon />
                            Details
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {canManage && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuItem onClick={() => setEditing(doc)}>
                                <PencilIcon />
                                Edit metadata
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => reindex(doc)} disabled={pending || isInFlight(doc)}>
                                <RefreshCwIcon />
                                Reindex
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(doc)}>
                                <Trash2Icon />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {filtered ? `${rows.length} of ${all.length} documents` : `${all.length} document${all.length === 1 ? "" : "s"}`}
      </p>

      <DocumentDetailSheet orgId={orgId} doc={details} onOpenChange={(open) => !open && setDetails(null)} />
      {canManage && (
        <>
          <EditMetadataSheet
            orgSlug={orgSlug}
            doc={editing}
            onOpenChange={(open) => !open && setEditing(null)}
            onSaved={replace}
            onReindexed={refresh}
          />
          <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {deleting?.doc_code ?? "this document"}?</AlertDialogTitle>
                <AlertDialogDescription>
                  &ldquo;{deleting?.title}&rdquo; and its indexed passages are removed, so answers stop citing it. Past
                  answers keep their text. Upload the PDF again to restore it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={pending} onClick={() => deleting && remove(deleting)}>
                  {pending && <Spinner data-icon="inline-start" />}
                  Delete document
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
