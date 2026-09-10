-- TU observation-driven follow-up report
-- Date: 2026-09-10
-- Scope:
-- 1) Rename the post-damage report to a technical follow-up control
-- 2) Treat prior documents as control context rather than current evidence
-- 3) Build future reports from current observations instead of a visible checklist

begin;

update public.settings_tu_report_templates
set
  title = 'Teknisk uppföljningskontroll efter skadeåtgärd',
  description = 'AI-stödd uppföljningskontroll efter rivning, sanering, uttorkning eller annan skadeåtgärd. Tidigare handlingar sammanfattas som intern inriktning och rapporten byggs av aktuella observationer.',
  document_title = 'Teknisk uppföljningskontroll efter skadeåtgärd',
  project_type = 'Teknisk uppföljningskontroll efter skadeåtgärd',
  version = greatest(version, 2),
  updated_at = now()
where key = 'post_damage_remediation_review';

with section_updates (
  template_section_key,
  title_override,
  ai_instruction
) as (
  values
    (
      'scope_basis_boundaries',
      'Uppdrag och avgränsning',
      'Beskriv kort uppdragets fråga, kontrollens omfattning och de avgränsningar som faktiskt påverkar slutsatsen. Tidigare handlingar är kontrollunderlag som visar vad kontrollen skulle inriktas mot; de är inte bevis för dagens förhållanden eller för att en åtgärd har utförts. Identifiera handlingarna kort och samlat utan att återberätta deras skadehistorik. Ange att uppdraget utgör en teknisk uppföljningskontroll och inte en entreprenadbesiktning eller ett godkännande av entreprenaden i avtalsrättslig mening.'
    ),
    (
      'review_execution_observations',
      'Kontrollens resultat',
      'Redovisa kontrollens relevanta aktuella observationer, bilder och kvalificerade mätningar grupperade efter område eller förhållande. Skriv observationstyrt och inte som en kontrollpunktslista eller en redogörelse för interna statusfält. Beskriv endast vad som faktiskt kunde iakttas eller verifieras vid den aktuella kontrollen. När ett resultat behöver klassificeras, använd i sak verifierad i kontrollerbar del, avvikelse noterad, kan inte verifieras, inte åtkomlig eller inte kontrollerad. Använd inte godkänd eller underkänd.'
    ),
    (
      'review_assessment_conclusion',
      'Samlad teknisk bedömning',
      'Besvara uppdragets huvudfråga utifrån den aktuella kontrollens observationer, bilder och kvalificerade mätningar. Tidigare handlingar får endast förklara kontrollens inriktning och får inte användas som bevis för aktuellt skick eller utförd åtgärd. Skilj tydligt mellan verifierat, bedömt och sådant som inte kunde verifieras. Skriv inte att en åtgärd saknas eller inte är utförd när underlaget endast visar att den inte kunde verifieras.'
    ),
    (
      'review_recommended_follow_up',
      'Rekommenderad fortsatt hantering',
      'Ange endast proportionerliga fortsatta kontroller, kompletteringar eller åtgärder som följer av den aktuella kontrollens resultat och samlade bedömning. Skilj ett kvarstående kontrollbehov från en konstaterad avvikelse. Fördela inte juridiskt ansvar och beskriv inte en åtgärd som beställd om det inte framgår av ett uttryckligt avtalat underlag.'
    )
)
update public.settings_tu_report_template_sections section
set
  title_override = section_updates.title_override,
  ai_instruction = section_updates.ai_instruction,
  updated_at = now()
from section_updates,
     public.settings_tu_report_templates template
where template.id = section.template_id
  and template.key = 'post_damage_remediation_review'
  and section.template_section_key = section_updates.template_section_key;

commit;
