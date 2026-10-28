/**
 * The help-shots project's globalSetup: the fail-closed database guard FIRST, then the standard
 * setup. The standard setup provisions the e2e roster and organizations into whatever database
 * the environment names, so a refusal has to come before it - otherwise a capture pointed at a
 * database that holds real data would already have written into it.
 */
import type { FullConfig } from "@playwright/test";
import standardGlobalSetup from "../support/global-setup";
import { assertFixtureOnlyDatabase } from "./guard";

export default async function helpShotsGlobalSetup(config: FullConfig): Promise<void> {
  await assertFixtureOnlyDatabase();
  await standardGlobalSetup(config);
}
