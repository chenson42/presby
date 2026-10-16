/**
 * The offline-gift FORM's flat values <-> the server's nested `OfflineGiftInput`
 * (docs/work-log/2026-10-15-online-giving.md, Flow 8). PURE.
 *
 * React Hook Form wants flat field names (`donorMode`, `newName`); the server
 * contract (`offlineGiftSchema`) is a discriminated union on `donor.mode`. The
 * form validates by running `offlineGiftSchema` itself over `giftFormToInput()`
 * and mapping each issue path back with `giftFieldName()`, so the client and
 * the server share ONE definition of valid.
 */
import type { OfflineGiftInput } from "./gift-input";

export type DonorMode = "existing" | "new" | "unidentified";

export interface GiftFormValues {
  donorMode: DonorMode;
  donorId: string;
  newName: string;
  newEmail: string;
  newAddressLine1: string;
  newCity: string;
  newRegion: string;
  newPostalCode: string;
  fundId: string;
  occurredOn: string;
  method: "cash" | "check" | "stock" | "other";
  amount: string;
  checkNumber: string;
  stockDescription: string;
  stockQuantity: string;
  memo: string;
}

/** The server input for a form's values. `acknowledgeDuplicate` is the second-submit flag. */
export function giftFormToInput(values: GiftFormValues, acknowledgeDuplicate = false): OfflineGiftInput {
  const donor: OfflineGiftInput["donor"] =
    values.donorMode === "existing"
      ? { mode: "existing", donorId: values.donorId }
      : values.donorMode === "unidentified"
        ? { mode: "unidentified" }
        : {
            mode: "new",
            displayName: values.newName,
            email: values.newEmail,
            addressLine1: values.newAddressLine1,
            city: values.newCity,
            region: values.newRegion,
            postalCode: values.newPostalCode,
          };
  return {
    donor,
    fundId: values.fundId,
    occurredOn: values.occurredOn,
    method: values.method,
    amount: values.amount,
    checkNumber: values.method === "check" ? values.checkNumber : "",
    stockDescription: values.method === "stock" ? values.stockDescription : "",
    stockQuantity: values.method === "stock" ? values.stockQuantity : "",
    memo: values.memo,
    acknowledgeDuplicate,
  };
}

const DONOR_FIELD: Record<string, keyof GiftFormValues> = {
  "donor.donorId": "donorId",
  "donor.displayName": "newName",
  "donor.email": "newEmail",
  "donor.addressLine1": "newAddressLine1",
  "donor.city": "newCity",
  "donor.region": "newRegion",
  "donor.postalCode": "newPostalCode",
  "donor.mode": "donorMode",
};

/** An issue path from `offlineGiftSchema` (`donor.displayName`, `amount`) -> the form field it belongs to. */
export function giftFieldName(path: string): keyof GiftFormValues | "_form" {
  if (path in DONOR_FIELD) return DONOR_FIELD[path]!;
  if (path === "_form" || path === "donor") return "_form";
  return path as keyof GiftFormValues;
}
