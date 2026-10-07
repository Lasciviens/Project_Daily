import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import type { ExtractedArticle } from '../articleExtract'

export type NewsArticle = ExtractedArticle

/**
 * The readable text of one news page, fetched and extracted server-side by the
 * `news-article` edge function (browsers can't read other sites under CORS).
 */
export async function fetchNewsArticle(url: string): Promise<NewsArticle> {
  const { data, error } = await supabase.functions.invoke('news-article', { body: { url } })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    const msg = typeof body?.message === 'string' ? body.message : null
    throw new Error(msg ?? 'The article could not be loaded')
  }
  const a = data as NewsArticle | null
  if (!a || !Array.isArray(a.paragraphs)) throw new Error('The article could not be loaded')
  return a
}
