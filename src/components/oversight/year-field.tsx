import type { UseFormRegisterReturn } from "react-hook-form";
import { TextField } from "./text-field";

/** A four-digit year, typed as text with the numeric keypad. */
export function YearField(props: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: UseFormRegisterReturn;
}) {
  return <TextField {...props} inputMode="numeric" />;
}
