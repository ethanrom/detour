"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { normalizeUrlInput } from "@/lib/ui/any-url";

/**
 * "Any public page": one labelled field and the page's one accent button. Without JavaScript it is a plain GET form
 * to /analyze?url=...; with it, the address is tidied (a missing https:// is added) and checked before the page
 * changes, and a problem is told in one sentence next to the field.
 */
export function UrlForm() {
  const router = useRouter();
  const fieldId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = normalizeUrlInput(input.current?.value ?? "");
    if (!checked.ok) {
      setError(checked.message);
      input.current?.focus();
      return;
    }
    setError("");
    router.push(`/analyze?url=${encodeURIComponent(checked.url)}`);
  }

  return (
    <form action="/analyze" method="get" noValidate onSubmit={onSubmit}>
      <label htmlFor={fieldId} className="hm-label">
        Any public page
      </label>
      <div className="hm-form-row">
        <input
          ref={input}
          id={fieldId}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://www.gov.uk"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          onChange={() => error && setError("")}
          className="hm-input"
        />
        <button type="submit" className="btn btn-accent hm-submit">
          Analyze
        </button>
      </div>
      <p id={errorId} role="alert" className="hm-form-err">
        {error}
      </p>
    </form>
  );
}
