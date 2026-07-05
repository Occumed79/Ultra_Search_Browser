export type SearchVerticalId =
  | "web"
  | "pdf"
  | "government"
  | "procurement"
  | "pricing"
  | "provider"
  | "contacts"
  | "technical"
  | "news"
  | "legal"
  | "medical"
  | "academic"
  | "financial";

export interface SearchVerticalConfig {
  id: SearchVerticalId;
  label: string;
  description: string;
  defaultOperators?: string[]; // operators that are applied by default for this vertical
  queryExpansions: string[]; // additional phrases/terms to expand the query with
  includedDomains?: string[]; // domains to prefer/include
  excludedDomains?: string[]; // domains to exclude
  preferredFileTypes?: string[]; // e.g. ['pdf']
  extractionTargets: string[]; // fields to attempt to extract from docs
  rankingBoosts?: {
    govDomain?: number;
    usDomain?: number;
    pdf?: number;
    exactPhrase?: number;
    containsPricing?: number;
    containsEmail?: number;
    containsDueDate?: number;
    occupationalHealthTerms?: number;
    [key: string]: number | undefined;
  };
  feedbackLabels?: string[];
}

export const DEFAULT_VERTICALS: SearchVerticalId[] = [
  "web",
  "pdf",
  "government",
  "procurement",
  "pricing",
  "provider",
  "contacts",
  "technical",
  "news",
  "legal",
  "medical",
  "academic",
  "financial",
];
