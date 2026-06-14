// ─── Search Lenses ───
export type SearchLens = "web" | "pdf" | "government" | "procurement" | "pricing" | "provider" | "technical" | "news" | "legal" | "medical" | "academic" | "financial";

export type SearchSource = "google" | "bing" | "duckduckgo" | "brave" | "wikipedia" | "github" | "stackoverflow" | "news" | "scholar" | "semantic";

// ─── Legacy generic search result (kept for backward compat) ───
export interface SearchResult {
  id: string;
  title: string;
  url: string;
  description: string;
  source: SearchSource;
  rank: number;
  score: number;
  timestamp: string;
  favicon?: string;
  domain: string;
  content?: string;
}

export interface Signal {
  name: string;
  score: number;
  description: string;
}

export interface IntelligenceObject {
  query: string;
  lens: SearchLens;
  summary?: string;
  confidence: number;
  signals: Signal[];
  sources: string[];
  queryExpansions: string[];
  timestamp: string;
  note?: string;
}

export interface ScrapedResult {
  title: string;
  url: string;
  description: string;
  domain: string;
  source: string;
  rank: number;
  score: number;
  resultType?: "web" | "pdf" | "government" | "procurement" | "pricing" | "technical" | "news" | "legal" | "medical" | "academic" | "financial";
  intelligence?: ProcurementIntelligence | ProviderIntelligence | PricingIntelligence | LegalIntelligence | MedicalIntelligence | AcademicIntelligence | FinancialIntelligence;
}

// ─── Intelligence Objects (Structured Data) ───

export interface ProcurementIntelligence {
  organization: string;
  opportunity_type: "RFP" | "RFQ" | "RFT" | "solicitation" | "bid" | "tender" | "procurement" | "unknown";
  service: string;
  due_date?: string;
  procurement_email?: string;
  procurement_phone?: string;
  source_confidence: number;
  document_url: string;
  matched_signals: string[];
  monetary_value?: string;
  posted_date?: string;
  status?: "open" | "active" | "closed" | "awarded" | "unknown";
}

export interface ProviderIntelligence {
  provider_name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  provider_phone?: string;
  services_offered: string[];
  source_confidence: number;
  website_url: string;
  matched_signals: string[];
  credentials?: string[];
  accepts_self_pay?: boolean;
  accepts_employer?: boolean;
}

export interface PricingIntelligence {
  provider_name: string;
  service: string;
  price_cash?: string;
  price_employer?: string;
  price_range?: string;
  source_confidence: number;
  document_url: string;
  matched_signals: string[];
  payment_types?: ("self-pay" | "cash" | "employer" | "insurance" | "work comp")[];
  service_category?: "PFT" | "DOT" | "physical" | "drug test" | "audiometry" | "respirator" | "unknown";
}

export interface LegalIntelligence {
  case_name?: string;
  court?: string;
  jurisdiction?: string;
  citation?: string;
  decision_date?: string;
  statute_name?: string;
  regulation_number?: string;
  source_confidence: number;
  document_url: string;
  matched_signals: string[];
  legal_type?: "case law" | "statute" | "regulation" | "compliance" | "unknown";
}

export interface MedicalIntelligence {
  condition?: string;
  treatment?: string;
  diagnosis?: string;
  study_type?: string;
  clinical_trial_id?: string;
  publication_date?: string;
  source_confidence: number;
  document_url: string;
  matched_signals: string[];
  medical_type?: "research" | "clinical" | "treatment" | "diagnosis" | "unknown";
}

export interface AcademicIntelligence {
  paper_title?: string;
  authors?: string[];
  journal?: string;
  publication_date?: string;
  doi?: string;
  citation_count?: number;
  abstract?: string;
  source_confidence: number;
  document_url: string;
  matched_signals: string[];
  academic_type?: "journal" | "conference" | "thesis" | "preprint" | "unknown";
}

export interface FinancialIntelligence {
  company_name?: string;
  ticker?: string;
  report_type?: string;
  reporting_period?: string;
  revenue?: string;
  profit?: string;
  eps?: string;
  source_confidence: number;
  document_url: string;
  matched_signals: string[];
  financial_type?: "earnings" | "report" | "market" | "economic" | "unknown";
}

export interface SearchFilters {
  sources: SearchSource[];
  timeRange: "any" | "day" | "week" | "month" | "year";
  contentType: "all" | "news" | "images" | "videos" | "academic" | "code" | "social";
  safeSearch: boolean;
  exactMatch: boolean;
  requireImages: boolean;
}

export interface AIInsight {
  summary: string;
  keyPoints: string[];
  relatedTopics: string[];
  confidence: number;
  sources: string[];
}

export interface SearchHistoryItem {
  id: string;
  query: string;
  timestamp: string;
  filters: SearchFilters;
  resultCount: number;
  starred: boolean;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  description: string;
  tags: string[];
  createdAt: string;
  folder: string;
}

export interface SearchSuggestion {
  text: string;
  type: "trending" | "related" | "history" | "ai";
  score: number;
}

export type ViewMode = "grid" | "list" | "compact" | "cards";

export type ThemeMode = "light" | "dark" | "system" | "oled" | "sepia";

export interface UserSettings {
  theme: ThemeMode;
  defaultSources: SearchSource[];
  resultsPerPage: number;
  autoSummarize: boolean;
  safeSearch: boolean;
  openInNewTab: boolean;
  showFavicons: boolean;
  showDescriptions: boolean;
  keyboardShortcuts: boolean;
  searchDelay: number;
  preferredLanguage: string;
  region: string;
  aiModel: string;
}
