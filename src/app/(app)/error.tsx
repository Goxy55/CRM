"use client";
import { Alert, Button } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-10">
      <Alert tone="error" title="Došlo je do greške">
        Stranica trenutno ne može da se prikaže. Pokušajte ponovo; ako se greška ponavlja, obratite se administratoru
        {error.digest ? ` i navedite oznaku ${error.digest}` : ""}.
      </Alert>
      <Button onClick={reset}>Pokušaj ponovo</Button>
    </div>
  );
}
