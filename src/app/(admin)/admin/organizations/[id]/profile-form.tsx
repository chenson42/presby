"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setOrganizationProfileAction, type PolicyResult } from "./actions";

/**
 * Fourth section on `/admin/organizations/<id>` — address, phone, and five
 * fixed social-link fields (docs/work-log/2026-08-21-public-site-org-
 * profile.md Phase 3, "Component / Page Plan"). Exact structural pattern as
 * `brand-form.tsx`: one `useActionState` form, an inline result banner (never
 * toast-only feedback — E-c1/E-c2's own "never a toast that vanishes"
 * reasoning applies here too), and typed values that survive a failed submit
 * because every field is client-owned state, never reset from the action
 * result.
 */

interface ProfileFormProps {
  organizationId: string;
  initialAddress: string | null;
  initialPhone: string | null;
  initialFacebookUrl: string | null;
  initialInstagramUrl: string | null;
  initialXTwitterUrl: string | null;
  initialYoutubeUrl: string | null;
  initialOtherUrl: string | null;
}

async function submitProfile(
  _prev: PolicyResult | null,
  formData: FormData,
): Promise<PolicyResult> {
  return setOrganizationProfileAction(formData);
}

export function ProfileForm({
  organizationId,
  initialAddress,
  initialPhone,
  initialFacebookUrl,
  initialInstagramUrl,
  initialXTwitterUrl,
  initialYoutubeUrl,
  initialOtherUrl,
}: ProfileFormProps) {
  const [address, setAddress] = useState(initialAddress ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [facebookUrl, setFacebookUrl] = useState(initialFacebookUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(initialInstagramUrl ?? "");
  const [xTwitterUrl, setXTwitterUrl] = useState(initialXTwitterUrl ?? "");
  const [youtubeUrl, setYoutubeUrl] = useState(initialYoutubeUrl ?? "");
  const [otherUrl, setOtherUrl] = useState(initialOtherUrl ?? "");

  const [result, formAction, isPending] = useActionState(
    submitProfile,
    null as PolicyResult | null,
  );

  // Toast is a SUPPLEMENT, not the record — matches brand-form.tsx's own
  // reasoning: the inline banner below is what persists.
  useEffect(() => {
    if (!result) return;
    if (result.ok) {
      toast.success("Profile saved.");
    } else {
      toast.error(result.error);
    }
  }, [result]);

  return (
    <form action={formAction} className="max-w-xl space-y-6">
      <input type="hidden" name="organizationId" value={organizationId} />

      {result && (
        <div
          role="status"
          className={
            result.ok
              ? "rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
              : "rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          }
        >
          {result.ok ? "Profile saved." : result.error}
        </div>
      )}

      <div>
        <Label htmlFor="address">Address</Label>
        <Input
          id="address"
          name="address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, Anytown, ST 00000"
          aria-describedby="addressHelp"
        />
        <p id="addressHelp" className="mt-1.5 text-xs text-muted-foreground">
          Shown as a &quot;Get Directions&quot; link on the public site. Leave
          blank to omit it entirely.
        </p>
      </div>

      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 555-0100"
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-foreground">
          Social links
        </legend>
        <p className="text-xs text-muted-foreground">
          Leave any of these blank to omit its icon from the public site — no
          field is required.
        </p>

        <div>
          <Label htmlFor="facebookUrl">Facebook</Label>
          <Input
            id="facebookUrl"
            name="facebookUrl"
            type="text"
            value={facebookUrl}
            onChange={(e) => setFacebookUrl(e.target.value)}
            placeholder="https://facebook.com/..."
          />
        </div>
        <div>
          <Label htmlFor="instagramUrl">Instagram</Label>
          <Input
            id="instagramUrl"
            name="instagramUrl"
            type="text"
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
            placeholder="https://instagram.com/..."
          />
        </div>
        <div>
          <Label htmlFor="xTwitterUrl">X / Twitter</Label>
          <Input
            id="xTwitterUrl"
            name="xTwitterUrl"
            type="text"
            value={xTwitterUrl}
            onChange={(e) => setXTwitterUrl(e.target.value)}
            placeholder="https://x.com/..."
          />
        </div>
        <div>
          <Label htmlFor="youtubeUrl">YouTube</Label>
          <Input
            id="youtubeUrl"
            name="youtubeUrl"
            type="text"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://youtube.com/..."
          />
        </div>
        <div>
          <Label htmlFor="otherUrl">Other link</Label>
          <Input
            id="otherUrl"
            name="otherUrl"
            type="text"
            value={otherUrl}
            onChange={(e) => setOtherUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
      </fieldset>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
