-- Full ES-DE game metadata and original image manifests. Existing owner RLS
-- applies to these variant columns; no new table, provider override or audit
-- trigger is needed. Device writes go through the authenticated Edge endpoint.
ALTER TABLE public.game_platforms
  ADD COLUMN IF NOT EXISTS esde_source jsonb,
  ADD COLUMN IF NOT EXISTS esde_source_hash text,
  ADD COLUMN IF NOT EXISTS esde_assets jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.game_platforms'::regclass AND conname='game_platforms_esde_assets_object') THEN
    ALTER TABLE public.game_platforms ADD CONSTRAINT game_platforms_esde_assets_object CHECK (jsonb_typeof(esde_assets)='object');
  END IF;
END $$;

COMMENT ON COLUMN public.game_platforms.esde_source IS
  'Lossless parsed ES-DE game XML plus system/folder context, separate from user/provider curation. No ROMs or credentials.';
COMMENT ON COLUMN public.game_platforms.esde_assets IS
  'Original non-PDF/non-video images keyed by exact source relative path: category, SHA256, size, MIME, storage URL.';

CREATE OR REPLACE FUNCTION public.esde_save_content(
  p_user_id uuid, p_variant_id uuid, p_kind text, p_value jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.game_platforms; item jsonb; k text; removed integer := 0;
BEGIN
  IF p_user_id IS NULL OR jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid content arguments';
  END IF;
  SELECT * INTO v FROM public.game_platforms
    WHERE id=p_variant_id AND user_id=p_user_id AND external_source='esde' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ES-DE variant not found'; END IF;
  IF p_kind='source' THEN
    IF coalesce(p_value->>'sha256','') !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(p_value->'document') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid source document';
    END IF;
    IF v.esde_source_hash IS DISTINCT FROM p_value->>'sha256' THEN
      UPDATE public.game_platforms SET esde_source=p_value->'document', esde_source_hash=p_value->>'sha256'
        WHERE id=v.id AND user_id=p_user_id;
    END IF;
  ELSIF p_kind='asset' THEN
    k := p_value->>'key';
    IF coalesce(k,'')='' OR jsonb_typeof(p_value->'asset') IS DISTINCT FROM 'object'
       OR coalesce(p_value->'asset'->>'sha256','') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Invalid asset';
    END IF;
    IF v.esde_assets->k IS DISTINCT FROM p_value->'asset' THEN
      UPDATE public.game_platforms SET esde_assets=esde_assets || jsonb_build_object(k,p_value->'asset')
        WHERE id=v.id AND user_id=p_user_id;
    END IF;
  ELSIF p_kind='prune' THEN
    IF jsonb_typeof(p_value->'entries') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_value->'entries') > 150 THEN
      RAISE EXCEPTION 'Invalid removal batch';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_value->'entries') LOOP
      k := item->>'key';
      IF coalesce(k,'')='' OR coalesce(item->>'sha256','') !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'Invalid removal identity';
      END IF;
      IF v.esde_assets ? k THEN
        IF v.esde_assets->k->>'sha256' IS DISTINCT FROM item->>'sha256' THEN
          RAISE EXCEPTION 'Asset changed since inventory';
        END IF;
        v.esde_assets := v.esde_assets-k; removed := removed+1;
      END IF;
    END LOOP;
    IF removed>0 THEN
      UPDATE public.game_platforms SET esde_assets=v.esde_assets WHERE id=v.id AND user_id=p_user_id;
    END IF;
  ELSE RAISE EXCEPTION 'Unknown content operation';
  END IF;
  RETURN jsonb_build_object('saved',true,'removed',removed);
END $$;
REVOKE ALL ON FUNCTION public.esde_save_content(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esde_save_content(uuid,uuid,text,jsonb) TO service_role;
