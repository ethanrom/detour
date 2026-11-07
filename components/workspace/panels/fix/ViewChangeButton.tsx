/** The text button that opens the change drawer. The visible words are "View change"; the name says which change. */
export function ViewChangeButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`View change: ${title}`}
      onClick={onClick}
      className="inline-flex min-h-8 items-center rounded px-1 text-sm font-medium underline underline-offset-2"
    >
      View change
    </button>
  );
}
