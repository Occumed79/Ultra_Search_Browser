import { ThumbsUp, ThumbsDown, Pin } from 'lucide-react'
import { ResultActions } from '@/components/result-actions'

// ... inside the SearchResultCard JSX, below the Visit link and domain

{/* Insert result actions here */}
<div className="mt-2">
  <ResultActions url={result.url} resultId={result.id || undefined} domain={domain} />
</div>
