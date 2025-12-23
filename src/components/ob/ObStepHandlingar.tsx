'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type TenureType = 'freehold' | 'bostadsratt' | null;
export type DwellingType = 'house' | 'apartment' | null;
export type InspectionSide = 'buyer' | 'seller' | null;

type InspectionDocumentStatus = 'present' | 'missing' | 'na';

interface Property {
  id: string;
  name: string | null;
  address: string | null;
  tenure_type: TenureType;
  dwelling_type: DwellingType;
}

interface Inspection {
  id: string;
  property_id: string;
  date: string | null;
  type: string | null;
  inspection_side: InspectionSide;
  assignment_number: string | null;
  defect_disclosures?: string | null; // fritext fel/brister
}

interface DocumentType {
  id: string;
  label: string;
  description: string | null;
  scope: string | null; // 'building' | 'property'
  is_active?: boolean | null;
}

interface InspectionDocument {
  id: string;
  inspection_id: string;
  document_type_id: string | null;
  title: string;
  status: InspectionDocumentStatus;
  document_date: string | null;
  document_value: number | null;
  note: string | null;
  created_at: string | null;
}

interface InspectionDisclosure {
  id: string;
  inspection_id: string;
  title: string | null;
  note: string | null;
}

const STATUS_LABELS = {
  present: 'Tillhandahållen',
  missing: 'Inte tillhandahållen',
  na: 'Bedöms ej relevant',
} as const;

const STANDARD_DEFECT_TEXT = 'Inga kända fel enligt fastighetsägaren.';

export default function ObStepHandlingar({
  property,
  inspection,
}: {
  property: Property;
  inspection: Inspection;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // saving-states
  const [savingDocs, setSavingDocs] = useState(false);
  const [savingDisclosure, setSavingDisclosure] = useState(false);
  const [savingDefect, setSavingDefect] = useState(false);
  const [savedDisclosure, setSavedDisclosure] = useState(false);
  const [savedDefect, setSavedDefect] = useState(false);

  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [documentsRaw, setDocumentsRaw] = useState<InspectionDocument[]>([]);

  // Upplysningar (fri text) via egen tabell (en rad)
  const [disclosure, setDisclosure] = useState<InspectionDisclosure | null>(null);
  const [disclosureText, setDisclosureText] = useState('');

  // Upplysningar om fel/brister (fri text) via inspections.defect_disclosures
  const [defectText, setDefectText] = useState(
    (inspection.defect_disclosures && inspection.defect_disclosures.trim() !== '')
      ? inspection.defect_disclosures
      : STANDARD_DEFECT_TEXT
  );

  // -------------------------------
  // Helpers
  // -------------------------------
  const fetchDocumentTypes = async (): Promise<DocumentType[]> => {
    const { data, error: dtErr } = await supabase
      .from('document_types')
      .select('id,label,description,scope,is_active')
      .in('scope', ['building', 'property'])
      .eq('is_active', true);

    if (dtErr) throw dtErr;
    return (data || []) as DocumentType[];
  };

  const fetchInspectionDocuments = async (): Promise<InspectionDocument[]> => {
    const { data, error: docsErr } = await supabase
      .from('inspection_documents')
      .select('*')
      .eq('inspection_id', inspection.id);

    if (docsErr) throw docsErr;
    return (data || []) as InspectionDocument[];
  };

  const ensureTemplateDocuments = async (types: DocumentType[], existing: InspectionDocument[]) => {
    // map: document_type_id -> newest row (hanterar dubletter utan att radera data)
    const newestByType = new Map<string, InspectionDocument>();

    for (const d of existing) {
      if (!d.document_type_id) continue;
      const prev = newestByType.get(d.document_type_id);
      if (!prev) {
        newestByType.set(d.document_type_id, d);
        continue;
      }
      const prevTs = prev.created_at ? new Date(prev.created_at).getTime() : 0;
      const dTs = d.created_at ? new Date(d.created_at).getTime() : 0;
      if (dTs >= prevTs) newestByType.set(d.document_type_id, d);
    }

    const missingTypes = types.filter(dt => !newestByType.has(dt.id));
    if (missingTypes.length === 0) return;

    const payload = missingTypes.map(dt => ({
      inspection_id: inspection.id,
      document_type_id: dt.id,
      title: dt.label,
      status: 'missing' as InspectionDocumentStatus,
      document_date: null,
      document_value: null,
      note: null,
    }));

    const { error: insErr } = await supabase
      .from('inspection_documents')
      .insert(payload);

    if (insErr) throw insErr;
  };

  const loadOrCreateDisclosureRow = async (): Promise<InspectionDisclosure> => {
    const { data, error: discErr } = await supabase
      .from('inspection_disclosures')
      .select('*')
      .eq('inspection_id', inspection.id);

    if (discErr) throw discErr;

    let row = (data && data[0]) as InspectionDisclosure | undefined;

    if (!row) {
      const { data: inserted, error: insErr } = await supabase
        .from('inspection_disclosures')
        .insert({
          inspection_id: inspection.id,
          title: 'upplysningar',
          note: '',
        })
        .select('*')
        .single();

      if (insErr) throw insErr;
      row = inserted as InspectionDisclosure;
    }

    return row;
  };

  const ensureDefectTextSaved = async () => {
    // Spara standardtext om fältet är tomt (så att "sparas om man inte gör något" uppfylls)
    const { data: inspRow, error: inspErr } = await supabase
      .from('inspections')
      .select('defect_disclosures')
      .eq('id', inspection.id)
      .single();

    if (inspErr) throw inspErr;

    const current = (inspRow?.defect_disclosures ?? '').trim();
    if (current !== '') {
      setDefectText(inspRow?.defect_disclosures ?? STANDARD_DEFECT_TEXT);
      return;
    }

    await supabase
      .from('inspections')
      .update({ defect_disclosures: STANDARD_DEFECT_TEXT })
      .eq('id', inspection.id);

    setDefectText(STANDARD_DEFECT_TEXT);
  };

  // -------------------------------
  // LOAD ALL + ENSURE TEMPLATE DOCS
  // -------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        setLoading(true);
        setError(null);

        const types = await fetchDocumentTypes();
        if (cancelled) return;
        setDocumentTypes(types);

        const existingDocs = await fetchInspectionDocuments();
        if (cancelled) return;

        // ✅ Seeda handlingar: skapa rader för saknade document_types
        await ensureTemplateDocuments(types, existingDocs);

        // Läs om efter ev insert
        const docsAfter = await fetchInspectionDocuments();
        if (cancelled) return;
        setDocumentsRaw(docsAfter);

        // disclosures (fri text) – säkerställ att en rad finns
        const disclosureRow = await loadOrCreateDisclosureRow();
        if (cancelled) return;
        setDisclosure(disclosureRow);
        setDisclosureText(disclosureRow.note ?? '');

        // defect_disclosures – säkerställ att standard sparas även utan input
        await ensureDefectTextSaved();
      } catch (e: any) {
        console.error(e);
        setError(e?.message || 'Ett fel inträffade.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (inspection?.id) loadAll();

    return () => {
      cancelled = true;
    };
  }, [inspection?.id]);

  // -------------------------------
  // DEDUPE + SORT (hide duplicates)
  // -------------------------------
  const documents = useMemo(() => {
    // Dedupe: visa bara senast skapade per document_type_id (custom docs med null id visas alltid)
    const newestByType = new Map<string, InspectionDocument>();
    const customs: InspectionDocument[] = [];

    for (const d of documentsRaw) {
      if (!d.document_type_id) {
        customs.push(d);
        continue;
      }
      const prev = newestByType.get(d.document_type_id);
      if (!prev) {
        newestByType.set(d.document_type_id, d);
        continue;
      }
      const prevTs = prev.created_at ? new Date(prev.created_at).getTime() : 0;
      const dTs = d.created_at ? new Date(d.created_at).getTime() : 0;
      if (dTs >= prevTs) newestByType.set(d.document_type_id, d);
    }

    const merged = [...newestByType.values(), ...customs];
    merged.sort((a, b) => a.title.localeCompare(b.title, 'sv'));
    return merged;
  }, [documentsRaw]);

  // -------------------------------
  // HANDLINGAR update
  // -------------------------------
  const updateDoc = async (id: string, patch: Partial<InspectionDocument>) => {
    setDocumentsRaw(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));
    setSavingDocs(true);

    const { error } = await supabase
      .from('inspection_documents')
      .update(patch)
      .eq('id', id);

    setSavingDocs(false);

    if (error) {
      console.error(error);
      setError('Kunde inte spara handling.');
    }
  };

  // -------------------------------
  // LÄGG TILL EGEN HANDLING
  // -------------------------------
  const handleAddCustomDocument = async () => {
    if (!inspection?.id) return;

    const title = window.prompt('Ange titel för den egna handlingen:');
    if (!title) return;

    setSavingDocs(true);
    setError(null);

    const insertPayload = {
      inspection_id: inspection.id,
      document_type_id: null,
      title,
      status: 'present' as InspectionDocumentStatus,
      document_date: null,
      document_value: null,
      note: null,
    };

    const { data, error } = await supabase
      .from('inspection_documents')
      .insert(insertPayload)
      .select('*')
      .single();

    setSavingDocs(false);

    if (error) {
      console.error(error);
      setError('Kunde inte lägga till handlingen.');
      return;
    }

    if (data) {
      setDocumentsRaw(prev => [...prev, data as InspectionDocument]);
    }
  };

  // -------------------------------
  // SAVE disclosureText (debounce)
  // -------------------------------
  useEffect(() => {
    if (!disclosure) return;

    setSavedDisclosure(false);
    const timeout = setTimeout(async () => {
      setSavingDisclosure(true);

      const { error } = await supabase
        .from('inspection_disclosures')
        .update({ note: disclosureText || '' })
        .eq('id', disclosure.id);

      setSavingDisclosure(false);

      if (error) {
        console.error(error);
        setError('Kunde inte spara upplysningar.');
        return;
      }

      setSavedDisclosure(true);
      setTimeout(() => setSavedDisclosure(false), 1500);
    }, 500);

    return () => clearTimeout(timeout);
  }, [disclosureText, disclosure]);

  // -------------------------------
  // SAVE defectText (debounce) – tomt => standard
  // -------------------------------
  useEffect(() => {
    if (!inspection?.id) return;

    setSavedDefect(false);
    const timeout = setTimeout(async () => {
      let valueToSave = defectText;

      if (!valueToSave || valueToSave.trim() === '') {
        valueToSave = STANDARD_DEFECT_TEXT;
        setDefectText(valueToSave);
      }

      setSavingDefect(true);

      const { error } = await supabase
        .from('inspections')
        .update({ defect_disclosures: valueToSave })
        .eq('id', inspection.id);

      setSavingDefect(false);

      if (error) {
        console.error(error);
        setError('Kunde inte spara upplysningar om fel.');
        return;
      }

      setSavedDefect(true);
      setTimeout(() => setSavedDefect(false), 1500);
    }, 500);

    return () => clearTimeout(timeout);
  }, [defectText, inspection?.id]);

  // -------------------------------
  // RENDER
  // -------------------------------
  if (loading) return <div className="p-4">Laddar…</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="space-y-8">
      {/* =======================
          HANDLINGAR
      ======================== */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">Handlingar</h2>
            <div className="text-xs text-gray-500">
              {property?.name || 'Fastighet'}
              {property?.address ? ` – ${property.address}` : ''}
            </div>
          </div>
          {savingDocs && <span className="text-xs text-gray-500">Sparar handling…</span>}
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Handling</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Datum</th>
                <th className="px-3 py-2 text-left">Notering</th>
              </tr>
            </thead>

            <tbody>
              {documents.map(doc => {
                const dt = doc.document_type_id
                  ? documentTypes.find(d => d.id === doc.document_type_id)
                  : null;

                return (
                  <tr key={doc.id} className="border-t">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{doc.title}</div>
                      {dt?.description && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {dt.description}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2 align-top">
                      <div className="flex gap-1 flex-wrap">
                        {Object.keys(STATUS_LABELS).map(key => (
                          <button
                            key={key}
                            onClick={() => updateDoc(doc.id, { status: key as any })}
                            className={
                              'px-2 py-1 rounded-full text-xs border ' +
                              (doc.status === key
                                ? 'bg-blue-50 border-blue-500 text-blue-700'
                                : 'bg-white border-gray-300 hover:bg-gray-50')
                            }
                          >
                            {STATUS_LABELS[key as keyof typeof STATUS_LABELS]}
                          </button>
                        ))}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      <input
                        type="date"
                        className="border rounded px-2 py-1 text-xs"
                        value={doc.document_date ?? ''}
                        onChange={e =>
                          updateDoc(doc.id, { document_date: e.target.value || null })
                        }
                      />
                    </td>

                    <td className="px-3 py-2 align-top">
                      <textarea
                        className="border rounded px-2 py-1 w-full text-xs min-h-[2.25rem]"
                        value={doc.note ?? ''}
                        onChange={e => updateDoc(doc.id, { note: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}

              {documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-gray-500">
                    Inga handlingar ännu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={handleAddCustomDocument}
            className="text-sm px-3 py-1.5 border rounded-md bg-white hover:bg-gray-50"
          >
            + Lägg till egen handling
          </button>
        </div>
      </section>

      {/* =======================
          UPPlysningar – fri text
      ======================== */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold">Upplysningar</h2>
          {savingDisclosure && <span className="text-xs text-gray-500">Sparar…</span>}
          {!savingDisclosure && savedDisclosure && (
            <span className="text-xs text-emerald-600">Sparad ✓</span>
          )}
        </div>

        <textarea
          className="w-full border rounded-lg px-3 py-2 min-h-[200px] text-sm"
          placeholder="Skriv alla upplysningar här …"
          value={disclosureText}
          onChange={e => setDisclosureText(e.target.value)}
        />
      </section>

      {/* =======================
          Upplysningar om fel i fastigheten
      ======================== */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold">Upplysningar om fel i fastigheten</h2>
          {savingDefect && <span className="text-xs text-gray-500">Sparar…</span>}
          {!savingDefect && savedDefect && (
            <span className="text-xs text-emerald-600">Sparad ✓</span>
          )}
        </div>

        <textarea
          className="w-full border rounded-lg px-3 py-2 min-h-[160px] text-sm"
          value={defectText}
          onChange={e => setDefectText(e.target.value)}
        />
      </section>
    </div>
  );
}
