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
  } catch (error: any) {
    console.error("Error reviewing court request:", error);
    
    const errStr = String(error?.stack || error?.message || error);
    const status = error?.status || error?.code || (error?.error && error.error.code);
    
    if (errStr.includes("Quota exceeded") || errStr.includes("quota") || errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED") || status === 429) {
      throw new Error("⚠️ CHYBA: PŘEKROČENÍ QUOTA LIMITU (429) pro Gemini API. Dosáhli jste limitu bezplatných požadavků (Free Tier) pro model gemini-3.5-flash ve Vašem projektu. Počkejte prosím chvíli (30-60 sekund) a zkuste akci opakovat.");
    }
    
    const msg = error?.message || (error?.error && error.error.message) || "Neznámá chyba při komunikaci s Gemini API.";
    throw new Error(`Chyba Gemini API: ${msg}`);
  }
}

export async function generateConsolidatedReport(
  analyses: { fileName: string; content: string }[]
) {
  try {
    const combinedAnalysesText = analyses
      .map(
        (a, idx) => `### ANALÝZA Č. ${idx + 1}: ${a.fileName}\n\n${a.content}\n\n---`
      )
      .join("\n\n");

    const systemPrompt = `Jste JURIS_CONSOLIDATION_ENGINE §LG13§. Vaším úkolem je vytvořit jednotný, zhuštěný a vysoce přehledný KONSOLIDAČNÍ REPORT ze všech dodaných analýz.
    Nemusíte opakovat obecné řeči z jednotlivých dokumentů. Udělejte jeden závěrečný, celostní report (Master Report), který sdruží vše podstatné.

    STRUKTURA KONSOLIDOVANÉHO REPORTU:
    1. 🔴 SOUHRNNÝ SEZNAM KRITICKÝCH NÁPRAV (All Critical Fixes) - jasný odrážkový seznam závažných procesních nebo argumentačních chyb napříč všemi složkami.
    2. 💎 DIAMANTY ARGUMENTACE (All Rhetorical/Legal Diamonds) - silné argumentační klenoty, klíčová judikatura, nebo excelentně zdůvodněné odstavce ze všech dokumentů, které musíme zachovat.
    3. ⚖️ CELKOVÉ DOPORUČENÍ (Ultimate Executive Roadmap) - co konkrétně je třeba provést krok za krokem před konečným odesláním.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Vytvoř konsolidovaný report z následujících dílčích analýz:\n\n${combinedAnalysesText}`,
      config: {
        systemInstruction: `${systemPrompt}\n\nVýstup musí být kompletně v českém jazyce. Používejte přehledné markdown formátování (nadpisy, tučný text, odrážky).`,
      },
    });

    return response.text || "";
  } catch (error: any) {
    console.error("Error in generateConsolidatedReport:", error);
    throw new Error(`Nepodařilo se vygenerovat konsolidovaný report: ${error?.message || String(error)}`);
  }
}

export async function runPreShipControl(
  files: { name: string; content: string; type: string }[]
) {
  try {
    const filesContext = files
      .map(
        (f) => `NÁZEV SOUBORU: ${f.name} (Typ: ${f.type})\nOBSAH:\n${f.content?.substring(0, 8000)}\n\n===`
      )
      .join("\n\n");

    const systemPrompt = `Jste JURIS_PRE_SHIP_CONTROLLER §LG13§, nejvyšší autonomní auditní instance provádějící finální kontrolu před odesláním spisu do datové schránky.
    Vaším úkolem je provést sérii bezprecedentních testů a simulací nad předloženými soubory:
    
    1. COMPLIANCE & LITIGATION RED-TEAMING - simulace kritického pohledu protistrany a odhalení mezer, chybějících příloh či podpisových doložek.
    2. LEGISLATIVNÍ KONTROLA (§) - ověření procesní čistoty a souladu s českými předpisy.
    3. ADMIN & METADATA CHECK - ověření, že jsou přítomny všechny typy souborů (PDF, ZIP, TXT) a jejich struktura sedí.
    4. OPTICKÁ, TYPOGRAFICKÁ & OCR ANALÝZA - kontrola formátování, čitelnosti, konzistence písem a vizuálního toku dokumentu.
    5. PSYCHOLOGIE SOUDEBNÍHO SENÁTU / ÚNAVA SOUDECE - Jak bude dokument působit při "rychlém čtení" (fast read / first read)? Kde hrozí, že unavený soudce ztratí pozornost? Navrhněte konkrétní korektivy pro zachování pozornosti v prvních 30 sekundách.

    MANDATORY OUTPUT STRUCTURE:
    # ⚓ FINÁLNÍ VYHODNOCENÍ - PRE-SHIP CONFORMITY REPORT

    ## 1. 🔍 DETEKCE A STRUKTURA SOUBORŮ
    - Zhodnocení složení (Počet hlavních vs. komplementárních elementů, doložky).

    ## 2. 🔴 KRITICKÁ RIZIKA (Red-Teaming & Compliance)
    - Konkrétní procesní a věcná rizika, která mohou způsobit odmítnutí nebo procesní neúspěch.

    ## 3. ⚖️ LEGISLATIVNÍ A PROCESNÍ ČISTOTA (§)
    - Dodržení lhůt, náležitostí podání, odkazů na správné paragrafy.

    ## 4. 📝 TYPOGRAFIE, ČITELNOST & OCR INTEGRITA
    - Zvládnutí vizuálního dojmu a případné chyby při převodu/OCR skenů.

    ## 5. 🧠 KOGNITIVNÍ KONTROLA & ÚNAVA SOUDECE (First/Fast Read)
    - Detailní rozbor toho, co soudce uvidí jako první. Kde hrozí únava pozornosti a jak ji udržet.

    ## 🏁 KONKRETNÍ ROZHODNUTÍ: [READY TO SHIP / BLOCKED - FIX REQUIRED]`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Proveď pre-ship kontrolní analýzu pro následující soubory balíčku:\n\n${filesContext}`,
      config: {
        systemInstruction: `${systemPrompt}\n\nVýstup musí být kompletně v češtině, strukturovaný a konkrétní.`,
      },
    });

    return response.text || "";
  } catch (error: any) {
    console.error("Error in runPreShipControl:", error);
    throw new Error(`Nepodařilo se provést pre-ship kontrolu: ${error?.message || String(error)}`);
  }
}

export async function analyzeChapterReview(
  chapterTitle: string,
  chapterText: string
) {
  try {
    const systemPrompt = `Jste JURIS_INTERACTIVE_REVIEWER §LG13§. Vaším úkolem je provést detailní, kapitálový rozbor dodaného textu jedné kapitoly.
    Poskytněte věcný rozbor, nalezené chyby, slabá místa (review comments) a jasnou notaci v bodech, na co se přesně soustředit, plus konkrétní návrhy vylepšení ve vytříbené češtině.
    Dále zanalyzujte strukturu v této kapitole: spočítejte hlavní argumenty (main elements) a doplňující tvrzení/důkazy (complementary elements).

    MANDATORY OUTPUT STRUCTURE:
    ## 📑 KONTROLA KAPITOLY: [Název kapitoly]
    
    ### 📊 STRUKTURÁLNÍ ELEMENTY KAPITOLY
    - **Hlavní argumenty (Main Elements)**: [Počet] - rozepište stručně které to jsou.
    - **Doplňující/Podpůrné elementy (Complementary Elements)**: [Počet] - odkaz na důkaz, judikát, procesní ustanovení.

    ### ❗ ANALYTICKÉ VYHODNOCENÍ & CRITICAL WARNINGS
    - [Odrážky s nalezenými riziky nebo chybami v této kapitole]

    ### 💡 NAVRHOVANÉ ZLEPŠENÍ (Kolektivní revize)
    - [Konkrétní, vylepšené formulace nebo doporučení k textaci]`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Název kapitoly: ${chapterTitle}\nText: ${chapterText}`,
      config: {
        systemInstruction: `${systemPrompt}\n\nVýstup musí být v češtině.`,
      },
    });

    return response.text || "";
  } catch (error: any) {
    console.error("Error in analyzeChapterReview:", error);
    throw new Error(`Nepodařilo se zanalyzovat kapitolu: ${error?.message || String(error)}`);
  }
}
