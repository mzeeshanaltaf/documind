"use client";

import { CircleCheckIcon, SendIcon } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { track } from "@/lib/analytics";
import { CONTACT_ERRORS, MESSAGE_MAX, contactSchema } from "@/lib/contact";

type Status = "idle" | "sending" | "sent";
type FieldErrors = Partial<Record<"name" | "email" | "message", string>>;

const FIELD_MESSAGES = {
  name: "Enter your name.",
  email: "Enter a valid email address, like name@company.com.",
  message: "Write a message.",
};

const noop = () => () => {};

/**
 * Progressive enhancement: the form is a real `action="/api/contact" method="post"`
 * form, so it submits (and the route redirects back with ?sent / ?error) even when
 * React never hydrates. Once hydrated, onSubmit takes over with fetch + inline errors.
 */
export function ContactForm({ initialSent = false, initialError }: { initialSent?: boolean; initialError?: string }) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  // Native validation for the no-JS path; our own messages once hydrated.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  const [status, setStatus] = useState<Status>(initialSent ? "sent" : "idle");
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      message: String(data.get("message") ?? ""),
    };

    const parsed = contactSchema.safeParse(values);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        errors[key] ??= key === "message" && issue.code === "too_big" ? CONTACT_ERRORS.length : FIELD_MESSAGES[key];
      }
      setFieldErrors(errors);
      setFormError(null);
      const first = (["name", "email", "message"] as const).find((key) => errors[key]);
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setStatus("sending");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed.data, hp_field: String(data.get("hp_field") ?? "") }),
      });
      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (response.ok && result?.success) {
        setStatus("sent");
        track("contact_submitted");
        return;
      }
      setFormError(result?.message ?? CONTACT_ERRORS.server);
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
    }
    setStatus("idle");
  }

  if (status === "sent") {
    return (
      <div role="status" className="flex flex-col items-start gap-4 py-6">
        <CircleCheckIcon className="size-7 text-success" aria-hidden />
        <div className="flex flex-col gap-2">
          <h2 className="font-heading text-2xl font-semibold">Message sent</h2>
          <p className="max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
            Thanks for writing. We read every message and reply to the email address you gave.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setStatus("idle");
            // Drop ?sent=1 so a reload doesn't show this again.
            window.history.replaceState(null, "", "/contact");
          }}
        >
          Send another message
        </Button>
      </div>
    );
  }

  const sending = status === "sending";
  const invalid = (key: keyof FieldErrors) => !!fieldErrors[key] || undefined;

  return (
    <form
      ref={formRef}
      action="/api/contact"
      method="post"
      onSubmit={onSubmit}
      noValidate={hydrated}
      className="relative flex flex-col gap-6"
    >
      <FormAlert message={formError} />

      {/* Honeypot: off-screen, out of the tab order and the accessibility tree, with a
          non-semantic name so browser autofill never fills it for a real person. */}
      <div aria-hidden className="absolute left-[-9999px] top-0 h-px w-px overflow-hidden">
        <label htmlFor={`${uid}-hp`}>Leave this field empty</label>
        <input id={`${uid}-hp`} name="hp_field" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <FieldGroup className="gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid("name")}>
            <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
            <Input
              id={`${uid}-name`}
              name="name"
              autoComplete="name"
              required
              maxLength={200}
              aria-invalid={invalid("name")}
              disabled={sending}
              className="h-10"
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>
          <Field data-invalid={invalid("email")}>
            <FieldLabel htmlFor={`${uid}-email`}>Work email</FieldLabel>
            <Input
              id={`${uid}-email`}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={320}
              aria-invalid={invalid("email")}
              disabled={sending}
              className="h-10"
            />
            <FieldError>{fieldErrors.email}</FieldError>
          </Field>
        </div>

        <Field data-invalid={invalid("message")}>
          <FieldLabel htmlFor={`${uid}-message`}>Message</FieldLabel>
          <Textarea
            id={`${uid}-message`}
            name="message"
            required
            rows={7}
            maxLength={MESSAGE_MAX}
            placeholder="Tell us about your policies: roughly how many documents, which countries, and what people ask most."
            aria-invalid={invalid("message")}
            disabled={sending}
            className="min-h-40 resize-y"
          />
          <FieldError>{fieldErrors.message}</FieldError>
        </Field>
      </FieldGroup>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">We only use your details to reply to you.</p>
        <Button type="submit" size="lg" className="h-10 px-4" disabled={sending}>
          {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          {sending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
