import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export async function reviewCourtRequest(
  text: string, 
  selectedFiles: string[], 
  selectedPillars: string[], 
  supportFiles: string[] = [], 
  instructions?: string, 
  mode: 'AUDIT' | 'COMPOSE' | 'VERSION_DIFF' | 'VERTICAL_DIFF' | 'BEST_COMBO_SYNTHESIS' = 'AUDIT', 
  compareVersions?: string[],
  skillsData: string[] = []
) {
  try {
    const pillarsList = selectedPillars.join(", ");
    const filesData = selectedFiles.join("\n\n---\n\n");
    const supportData = supportFiles.join("\n\n---\n\n");
    const skillsCombined = skillsData.map((s, idx) => `[PRÁVNÍ_SKILL_${idx + 1}]:\n${s}`).join("\n\n---\n\n");

    let systemPrompt = "";
    if (mode === 'AUDIT') {
      systemPrompt = `Jste JURISREVIEW CORE §LG13§, vysoce výkonná instance pro forenzní právní audit podle českého právního řádu. 
      Vaším úkolem je hloubková analýza DODANÉHO OBSAHU souborů.
      
      MANDATORY OUTPUT STRUCTURE:
      1. HLAVNÍ NÁLEZY (Critical Risks)
      2. PODROBNÁ ANALÝZA DLE PILÍŘŮ
      3. MAPA ZMĚN A KONTINUITY: Jasně identifikujte, co se oproti referencím změnilo, co přibylo a co bylo vypuštěno.`;
    } else if (mode === 'COMPOSE') {
      systemPrompt = `Jste JURIS_COMPOSITION_ENGINE §LG13§. Vaším úkolem je SESTAVIT nebo DOPLNIT právní dokument na základě instrukcí, zdrojového OBSAHU souborů a existujícího draftu.
      
      MANDATORY OUTPUT STRUCTURE:
      1. GENEROVANÝ TEXT DOKUMENTU
      2. MAPA ROZDÍLŮ: Vysvětlete, jak se nový text liší od původního draftu/pokynů.`;
    } else if (mode === 'VERSION_DIFF') {
      systemPrompt = `Jste JURIS_EVOLUTION_ANALYST §LG13§. Vaším úkolem je POROVNAT vývoj podání mezi verze ${compareVersions?.[0]} (ZÁKLAD) a ${compareVersions?.[1]} (PŘÍRASTK) na základě analýzy jejich OBSAHU. 
      Analyzujte, zda změny přinášejí reálnou hodnotu (Value) nebo jen zvyšují komplexitu.
      
      MANDATORY OUTPUT STRUCTURE:
      1. SUMÁŘ EVOLUCE (Co je nového v jádru argumentace)
      2. MAPA ZMĚN (Bod po bodu: Smazáno vs. Přidáno vs. Změněno)
      3. HODNOCENÍ SÍLY (Strength) & PRAVDĚPODOBNOSTI ÚSPĚCHU (Probability of Success)
      4. STRATEGICKÝ VERDIKT (PODAT / OPRAVIT / VRÁTIT ZMĚNY)`;
    } else if (mode === 'VERTICAL_DIFF') {
      systemPrompt = `Jste JURIS_CHRONO_ANALYST §LG13§. Vaším úkolem je provést hloubkovou VERTIKÁLNÍ CHRONOLOGICKOU ANALÝZU vývoje podání / dokumentu napříč VŠEMI dostupnými verzemi: ${compareVersions?.join(', ') || 'všechny dostupné'}.
      Detailně zmapujte vývojovou trajektorii argumentace, změn v nárocích, argumentačních přesunech a celkové síle.
      Rozhodněte, zda novější verze představují reálné zlepšení, nebo zda trpí "argumentačním balastem" či jinými riziky.
      
      MANDATORY OUTPUT STRUCTURE:
      1. CHRONOLOGOCKÁ MAPA VÝVOJE (Srovnání verze po verzi)
      2. ROZDÍLOVÁ ANALÝZA ARGUMENTŮ (Změny, upřesnění, nová fakta)
      3. EVOLUČNÍ MATRICE (Srovnání síly, pravděpodobnosti úspěchu a míry balastu pro každou verzi)
      4. DOPORUČENÝ POSTUP (Kterou verzi zvolit nebo jak zkombinovat to nejlepší)`;
    } else if (mode === 'BEST_COMBO_SYNTHESIS') {
      systemPrompt = `Jste JURIS_SYNTHESIS_ENGINE §LG13§. Vaším úkolem je vzít více verzí téhož dokumentu/návrhu a pospojovat a přetvořit je v JEDINOU SUPRÉMNÍ NEJLEPŠÍ MOŽNOU KOMBINACI.
      Pečlivě analyzujte každý vstup, vyberte nejpřesnější formulace, nejlépe provázaná tvrzení a nejúčinnější právní argumentaci a judikaturu.
      Odstraňte duplicity, stylistické nekonzistence a logické či věcné rozpory mezi verzemi.
      Cílem je vytvořit dokonale vyargumentovaný, nekompromisní, koherentní právní dokument v excelentní profesionální češtině.
      
      MANDATORY OUTPUT STRUCTURE:
      1. SUPRÉMNÍ SYNTEZOVANÝ TEXT DOKUMENTU (Plný obsah k podání)
      2. ANALYTICKÁ ZPRÁVA Slučování (Co bylo převzato odkud a proč)
      3. ODSTRANĚNÉ ROZPORY & ZVÝŠENÍ PRÁVNÍ INTEGRITY`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: text || (
        mode === 'VERSION_DIFF' ? `Analyzuj rozdíly v obsahu mezi verzemi ${compareVersions?.join(' a ')}.` :
        mode === 'VERTICAL_DIFF' ? `Analyzuj vertikální vývoj napříč verzemi: ${compareVersions?.join(', ')}.` :
        mode === 'BEST_COMBO_SYNTHESIS' ? "Syntetizuj nejlepší kombinaci z předložených verzí souborů." :
        "Analyzuj dodaný obsah souborů."
      ),
      config: {
        systemInstruction: `${systemPrompt}
        
        OBSAH SOUBORŮ K HLAVNÍ ANALÝZE/ZPRACOVÁNÍ:
        ${filesData}
        
        OBSAH PODPŮRNÝCH KONTEXTOVÝCH SOUBORŮ (Reference):
        ${supportData}
        
        ${skillsCombined ? `
        AKTIVNÍ PRÁVNÍ METODIKA A SCHÉMATA (Skills):
        ${skillsCombined}
        
        ZÁVAZNÝ INSTRUKČNÍ RÁMEC: Při analýze / syntéze musíte striktně zohlednit a aplikovat výše uvedené expertní PRÁVNÍ SKILLS/METODIKY!
        ` : ""}

        AKTIVNÍ PILÍRE AUDITU (Metodika): [${pillarsList}]
        
        ${mode === 'VERSION_DIFF' ? `
        SPECIFICKÉ ÚKOLY PRO VERSION_DIFF:
        1. Diferenční analýza: Co ubylo, co přibylo, co se změnilo zásadně.
        2. Výpočet evolučního skóre: Význam Změny (Value) x Pravděpodobnost Úspěchu (Prob) = Total Score Verze.
        3. Kategorizace změn: MINOR (kosmetické), MEDIUM (věcné), NO GO CRITICAL (blokující podání).
        4. Strategické doporučení: "PODAT" vs "DÁLE DOPLŇOVAT". Zhodnoť, zda se vyplatilo čekat na upgrades.
        ` : ""}

        ${mode === 'VERTICAL_DIFF' ? `
        SPECIFICKÉ ÚKOLY PRO VERTIKÁLNÍ ANALÝZU:
        1. Chronologický audit: Mapujte postupné krystalizování argumentů napříč všemi verzemi.
        2. Analýza přínosu verzí: Zda každá další verze přináší zvýšenou relevanci nebo jen textovou zátěž.
        3. Analýza rizik vzniku rozporů: Sledujte, zda se s vývojem neztratila silná procesní stanoviska.
        ` : ""}

        ${mode === 'BEST_COMBO_SYNTHESIS' ? `
        SPECIFICKÉ ÚKOLY PRO SUPRÉMNÍ SYNTÉZU:
        1. Fúze argumentů: Najděte nejlepší pasáže pro každou část argumentu a poskládejte je.
        2. Stylistické sjednocení: Sjednoťte terminologii a styl do jednolitého textu.
        3. Právní zátěžový test: Ujistěte se, že finální text neobsahuje žádné protichůdné věty ze starých verzí.
        ` : ""}

        VÝSTUPNÍ FORMÁT (Pro ${mode}):
        ${mode === 'VERSION_DIFF' ? `1. EVOLUČNÍ PŘEHLED (V1 ➔ V2)
        2. SEZNAM DIFERENCÍ (DIFF REPORT)
        3. HODNOCENÍ DOPADU ZMĚN (Impact Analysis)
        4. EVOLUČNÍ FORMULE (Value x Prob)
        5. STRATEGICKÝ VERDIKT (PODAT / OPRAVIT / POKRAČOVAT)` : 
        mode === 'VERTICAL_DIFF' ? `1. EVOLUČNÍ TRAJEKTORIE SPISU
        2. PODROBNÉ MULTI-VERZNÍ SROVNÁNÍ
        3. HODNOCENÍ KNOTTED-POINTS (Zauzlení a komplikace)
        4. EVOLUČNÍ FORMULE PRO VERZE
        5. EXPOLATIVNÍ ROZHODNUTÍ` :
        mode === 'BEST_COMBO_SYNTHESIS' ? `1. VÝSLEDNÝ SUPRÉMNÍ DOKUMENT
        2. HISTOGRAM INTEGRACE (Části a jejich původ)
        3. INTEGRITY CHECK (Odstraněné rozpory)
        4. STRATEGICKÉ DOPORUČENÍ K PODÁNÍ` :
        mode === 'AUDIT' ? `1. SEZNAM ANALYZOVANÝCH SOUBORŮ
        2. KONTEXTUÁLNÍ PLÁN AUDITU
        3. FORENSIC_ANALYSIS
        4. ATOM_INTEGRITY_CHECK
        5. ARGUMENT_HIERARCHY_REPORT
        6. RISK_ASSESSMENT & COMPLIANCE
        7. EXECUTIVE_RECOMMENDATIONS` : `1. PŘEHLED ZPRACOVANÝCH ZDROJŮ
        2. STRUKTURA NOVÉHO NÁVRHU
        3. FINÁLNÍ TEXT DOKUMENTU
        4. SEZNAM DOPLNĚNÝCH ATOMŮ`}
        
        10. JSON_STRUCTUREDATA (Kódový blok s JSON objektem: 
          score: number, 
          improvementPercent: number, 
          riskLevel: "LOW" | "MEDIUM" | "HIGH", 
          verdict: "SUBMIT" | "WAIT", 
          recommendations: string[],
          diffStats: { added: number, removed: number, changed: number },
          metrics: { 
            strength: number, // 0-100
            probability: number, // 0-100
            complexity: number // 0-100
          },
          actions: {
            add: string[],
            remove: string[],
            modify: string[],
            revert: string[] // List of things to revert to previous version
          }
        )
        
        Dodatečné pokyny k verzi/draftu:
        ${instructions || 'Žádné specifické pokyny.'}
        
        Tón: Chladný, profesionální, heuristický. NEPOSKYTUJTE právní poradenství.
        VEŠKERÝ VÝSTUP MUSÍ BÝT V ČEŠTINĚ.`,
      },
    });

    return response.text;
  } catch (error) {
    console.error("Error reviewing court request:", error);
    throw new Error("Failed to process the request. Please check your text and try again.");
  }
}
