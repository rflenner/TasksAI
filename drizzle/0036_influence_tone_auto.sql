-- Influence lines used to be saved with an explicit "neutral" kind. The kind now follows the mindset of the influencer
-- (Enemy red, Champion and Coach green, otherwise blue) unless someone sets it by hand, so the old default is dropped.
UPDATE org_charts SET influences = (
  SELECT COALESCE(jsonb_agg(CASE WHEN e->>'tone' = 'neutral' THEN e - 'tone' ELSE e END), '[]'::jsonb)
  FROM jsonb_array_elements(influences) AS e
) WHERE jsonb_array_length(influences) > 0;
