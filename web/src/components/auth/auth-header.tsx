export function AuthHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-1.5">
      <h1 className="font-heading text-[1.7rem] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}
