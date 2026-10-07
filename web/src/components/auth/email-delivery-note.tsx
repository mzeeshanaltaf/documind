/** Persistent (not a toast): people read it after switching to their mail client. */
export function EmailDeliveryNote({ sender }: { sender: string | null }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      Can&apos;t find it? Check your spam or junk folder
      {sender ? (
        <>
          {" "}for mail from <span className="font-medium wrap-anywhere text-foreground">{sender}</span>.
        </>
      ) : (
        "."
      )}
    </p>
  );
}
