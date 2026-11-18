import type { UseFormRegisterReturn } from "react-hook-form";
import { TextField } from "./text-field";

/** Dollars, typed as text with the decimal keypad ("1250000" or "1250000.50"); the validator turns it into cents. */
export function MoneyField(props: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: UseFormRegisterReturn;
}) {
  return <TextField {...props} inputMode="decimal" />;
}
