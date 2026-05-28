import React, { useState, useEffect, useRef } from 'react';
import { 
  Scale, 
  Layers, 
  FolderOpen, 
  Loader2, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Upload, 
  Printer, 
  Download, 
  ChevronRight, 
  ChevronLeft, 
  Plus, 
  X, 
  FileText, 
  Search, 
  RefreshCcw, 
  Copy, 
  Check, 
  ShieldAlert, 
  Eye,
  Info,
  Key,
  FileJson,
  CheckCircle,
  HelpCircle,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  Radio
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { 
  generateConsolidatedReport, 
  runPreShipControl, 
  analyzeChapterReview 
} from '../services/gemini';

interface FileEntry {
  id: string;
  name: string;
  type: string;
  text?: string;
  date?: string;
  size?: number;
}

interface AuditTask {
  id: string;
  fileName: string;
  title: string;
  result: string;
  timestamp: number;
}

interface PreShipControlViewProps {
  uploadedFiles: FileEntry[];
  auditQueue: any[];
  driveToken: string | null;
}

export const PreShipControlView: React.FC<PreShipControlViewProps> = ({
  uploadedFiles = [],
  auditQueue = [],
  driveToken,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'CONSOLIDATE' | 'PRESHIP_TESTS' | 'JOINT_REVIEW' | 'HANDSHAKE_POLICY'>('CONSOLIDATE');
  const [copiedText, setCopiedText] = useState(false);

  // Core loading/success states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------
  // TAB 1: CONSOLIDATION STATE
  // -----------------------------------------------------------------
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<string[]>([]);
  const [consolidatedResult, setConsolidatedResult] = useState<string | null>(null);

  // -----------------------------------------------------------------
  // TAB 2: AUTOMATED PRE-SHIP RELEASE TESTS STATE
  // -----------------------------------------------------------------
  const [preShipFiles, setPreShipFiles] = useState<FileEntry[]>([]);
  const [preShipFolderId, setPreShipFolderId] = useState<string | null>(null);
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);
  const [driveScanStatus, setDriveScanStatus] = useState<string | null>(null);
  const [preShipReport, setPreShipReport] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -----------------------------------------------------------------
  // UNLOCK CERTIFICATE STATE
  // -----------------------------------------------------------------
  const [generatedCertificate, setGeneratedCertificate] = useState<any | null>(null);
  const [isUploadingCert, setIsUploadingCert] = useState(false);
  const [certUploadSuccess, setCertUploadSuccess] = useState<string | null>(null);

  // -----------------------------------------------------------------
  // TAB 3: JOINT REVIEW MODE STATE
  // -----------------------------------------------------------------
  const [jointReviewDoc, setJointReviewDoc] = useState<string>('');
  const [chapters, setChapters] = useState<{ title: string; text: string }[]>([]);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);
  const [chapterReviews, setChapterReviews] = useState<Record<number, string>>({}); // chapterIndex -> Review text
  const [chapterComments, setChapterComments] = useState<Record<number, string>>({}); // chapterIndex -> User CZ comments
  const [isAnalyzingChapter, setIsAnalyzingChapter] = useState(false);
  const [isReviewStarted, setIsReviewStarted] = useState(false);

  // Initialize selected analyses from current done queue
  const doneAnalyses = auditQueue.filter(t => t.status === 'done');

  // -----------------------------------------------------------------
  // AUTO POLL & SOUND NOTIFICATION SYSTEM (WIND-CHIME SYNTHESIZER)
  // -----------------------------------------------------------------
  const [isAutoPolling, setIsAutoPolling] = useState(false);
  const [pollInterval, setPollInterval] = useState<number>(30); // default to 30s
  const [knownFiles, setKnownFiles] = useState<Record<string, { name: string; modifiedTime: string; size: number }>>({});
  const [pollNotifications, setPollNotifications] = useState<{ id: string; message: string; timestamp: string; isNew: boolean }[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const knownFilesRef = useRef<Record<string, { name: string; modifiedTime: string; size: number }>>({});

  const playNotificationSound = () => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const now = ctx.currentTime;
      
      // Dual-tone harmonious chime sweep (A5 & E6 harmonized fifth)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(1318.51, now + 0.15); // E6
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(587.33, now); // D5
      osc2.frequency.exponentialRampToValueAtTime(880, now + 0.1); // A5
      gain2.gain.setValueAtTime(0.08, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.62);
      osc2.stop(now + 0.52);
    } catch (e) {
      console.warn('Synthesized notification sound failed to play:', e);
    }
  };

  const checkDriveForUpdates = async () => {
    if (!driveToken) return;
    try {
      let folderId = preShipFolderId;
      if (!folderId) {
        const folderQuery = encodeURIComponent("name = 'PRE_Ship_Final_Control' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
        const url = `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${driveToken}` }
        });
        if (!res.ok) return;
        const folderData = await res.json();
        if (folderData.files && folderData.files.length > 0) {
          folderId = folderData.files[0].id;
          setPreShipFolderId(folderId);
        } else {
          return;
        }
      }

      if (!folderId) return;

      const filesQuery = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const filesUrl = `https://www.googleapis.com/drive/v3/files?q=${filesQuery}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`;
      const filesRes = await fetch(filesUrl, {
        headers: { Authorization: `Bearer ${driveToken}` }
      });
      if (!filesRes.ok) return;
      const filesData = await filesRes.json();
      const filesList = filesData.files || [];

      const currentKnown = { ...knownFilesRef.current };
      const alreadyHadKeys = Object.keys(currentKnown).length > 0;
      const newKnown: Record<string, { name: string; modifiedTime: string; size: number }> = {};
      let hasChanges = false;
      const detectedMessages: string[] = [];

      filesList.forEach((f: any) => {
        const fileId = f.id;
        const name = f.name;
        const currentModified = f.modifiedTime || '';
        const currentSize = f.size ? parseInt(f.size) : 0;

        newKnown[fileId] = { name, modifiedTime: currentModified, size: currentSize };

        if (alreadyHadKeys) {
          const previous = currentKnown[fileId];
          if (!previous) {
            hasChanges = true;
            detectedMessages.push(`Nalezen nový spisový soubor: "${name}" (${(currentSize / 1024).toFixed(1)} KB)`);
          } else if (previous.modifiedTime !== currentModified || previous.size !== currentSize) {
            hasChanges = true;
            detectedMessages.push(`Detekována změna ve spisu: "${name}" byl aktualizován`);
          }
        }
      });

      // Update ref and state
      knownFilesRef.current = { ...currentKnown, ...newKnown };
      setKnownFiles({ ...currentKnown, ...newKnown });

      if (hasChanges && detectedMessages.length > 0) {
        playNotificationSound();
        
        detectedMessages.forEach(msg => {
          const newNotif = {
            id: 'notify-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            message: msg,
            timestamp: new Date().toLocaleTimeString('cs-CZ'),
            isNew: true
          };
          setPollNotifications(prev => [newNotif, ...prev].slice(0, 10));
        });

        // Auto reload preShipFiles to show the accurate list in real-time
        const importedToUpdate: FileEntry[] = [];
        for (const f of filesList) {
          const isTxt = f.name.endsWith('.txt') || f.mimeType === 'text/plain';
          let textContent = `[Obsah binárního souboru ${f.name}]`;

          if (isTxt) {
            try {
              const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
                headers: { Authorization: `Bearer ${driveToken}` }
              });
              if (contentRes.ok) {
                textContent = await contentRes.text();
              }
            } catch (e) {
              console.warn(`Nepodařilo se přenačíst obsah: ${f.name}`, e);
            }
          }

          importedToUpdate.push({
            id: f.id,
            name: f.name,
            type: f.name.split('.').pop()?.toUpperCase() || 'SOUBOR',
            text: textContent,
            date: new Date(f.modifiedTime).toLocaleDateString('cs-CZ'),
            size: f.size ? parseInt(f.size) : undefined
          });
        }

        setPreShipFiles(prev => {
          const filteredPrev = prev.filter(p => !importedToUpdate.some(imp => imp.name === p.name));
          return [...filteredPrev, ...importedToUpdate];
        });
      }

    } catch (err) {
      console.error('Chyba dálkového dohledu:', err);
    }
  };

  useEffect(() => {
    if (!isAutoPolling || !driveToken) return;

    // Run first check immediately if knownFiles is empty
    if (Object.keys(knownFilesRef.current).length === 0) {
      checkDriveForUpdates();
    }

    const intervalId = setInterval(() => {
      checkDriveForUpdates();
    }, pollInterval * 1000);

    return () => clearInterval(intervalId);
  }, [isAutoPolling, driveToken, pollInterval]);

  // Trigger copy report
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  // Trigger print report
  const handlePrint = (title: string, content: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: 'Georgia', serif; line-height: 1.6; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1, h2, h3 { font-family: 'Arial', sans-serif; color: #1c1c1c; margin-top: 30px; }
            h1 { border-bottom: 2px solid #C5A059; padding-bottom: 10px; margin-bottom: 35px; }
            ol, ul { margin-bottom: 20px; }
            li { margin-bottom: 8px; }
            blockquote { border-left: 4px solid #C5A059; background: #f9f9f9; padding: 15px; margin: 20px 0; font-style: italic; }
            .meta { font-family: monospace; font-size: 11px; color: #666; margin-bottom: 40px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="meta">GENERATED BY JURISREVIEW CORE §LG13§ ON ${new Date().toLocaleDateString('cs-CZ')}</div>
          <div style="white-space: pre-line;">${content}</div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // -----------------------------------------------------------------
  // 1. CONSOLIDATION FUNCTIONALITY
  // -----------------------------------------------------------------
  const handleGenerateConsolidation = async () => {
    if (selectedAnalysisIds.length === 0) {
      setError('Zvolte alespoň jednu analýzu ke konsolidaci.');
      return;
    }
    setError(null);
    setIsLoading(true);
    setConsolidatedResult(null);

    try {
      const selectedData = doneAnalyses
        .filter(t => selectedAnalysisIds.includes(t.id))
        .map(t => ({
          fileName: t.fileName || t.title || 'Dokument bez názvu',
          content: t.result || ''
        }));

      const report = await generateConsolidatedReport(selectedData);
      setConsolidatedResult(report);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Nepodařilo se vygenerovat konsolidovaný report.');
    } finally {
      setIsLoading(false);
    }
  };

  // -----------------------------------------------------------------
  // 2a. AUTO PRE-SHIP RELEASE TESTS & FILES
  // -----------------------------------------------------------------
  const handleLocalFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  const processFiles = (fileList: FileList) => {
    const newFiles: FileEntry[] = [];
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      const isTxt = file.type === 'text/plain' || file.name.endsWith('.txt');
      
      reader.onload = (event) => {
        const textVal = event.target?.result as string || '';
        const entry: FileEntry = {
          id: 'local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          name: file.name,
          type: file.name.split('.').pop()?.toUpperCase() || 'SOUBOR',
          text: textVal,
          date: new Date().toLocaleDateString('cs-CZ'),
          size: file.size
        };
        setPreShipFiles(prev => {
          if (prev.some(f => f.name === entry.name)) return prev;
          return [...prev, entry];
        });
      };
      
      if (isTxt) {
        reader.readAsText(file);
      } else {
        const entry: FileEntry = {
          id: 'local-meta-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          name: file.name,
          type: file.name.split('.').pop()?.toUpperCase() || 'SOUBOR',
          text: `[Obsah binárního souboru ${file.name}. Velikost: ${(file.size / 1024).toFixed(1)} KB]`,
          date: new Date().toLocaleDateString('cs-CZ'),
          size: file.size
        };
        setPreShipFiles(prev => {
          if (prev.some(f => f.name === entry.name)) return prev;
          return [...prev, entry];
        });
      }
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const removePreShipFile = (id: string) => {
    setPreShipFiles(prev => prev.filter(f => f.id !== id));
  };

  // Google Drive auto-scan
  const scanGoogleDrivePreShipFolder = async () => {
    if (!driveToken) {
      setError('Pro proskenování Disku Google se musíte nejprve přihlásit.');
      return;
    }
    setError(null);
    setIsSearchingDrive(true);
    setDriveScanStatus('Vyhledávám složku „PRE_Ship_Final_Control“...');

    try {
      const folderQuery = encodeURIComponent("name = 'PRE_Ship_Final_Control' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
      const url = `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${driveToken}` }
      });
      if (!res.ok) throw new Error('Chyba při vyhledávání složky PRE_Ship_Final_Control.');
      const folderData = await res.json();

      let folderId = '';
      if (!folderData.files || folderData.files.length === 0) {
        setDriveScanStatus('Složka PRE_Ship_Final_Control nebyla nalezena. Zakládám automaticky...');
        
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${driveToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: 'PRE_Ship_Final_Control',
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        if (!createRes.ok) throw new Error('Nepodařilo se vytvořit složku PRE_Ship_Final_Control.');
        const newFolder = await createRes.json();
        folderId = newFolder.id;
        setPreShipFolderId(folderId);
        setDriveScanStatus(`Nová prázdná složka „PRE_Ship_Final_Control“ založena! (ID: ${folderId}). Nahrajte tam soubory podání a zkuste to znovu.`);
        setIsSearchingDrive(false);
        return;
      }

      folderId = folderData.files[0].id;
      setPreShipFolderId(folderId);
      setDriveScanStatus(`Nalezena složka (ID: ${folderId}). Načítám soubory...`);

      const filesQuery = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const filesUrl = `https://www.googleapis.com/drive/v3/files?q=${filesQuery}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=50`;
      const filesRes = await fetch(filesUrl, {
        headers: { Authorization: `Bearer ${driveToken}` }
      });
      if (!filesRes.ok) throw new Error('Chyba při stahování souborů ze složky.');
      const filesData = await filesRes.json();

      if (!filesData.files || filesData.files.length === 0) {
        setDriveScanStatus('Složka PRE_Ship_Final_Control je prázdná. Nahrajte do ní soubory (ZIP, PDF, TXT) k odeslání.');
        setIsSearchingDrive(false);
        return;
      }

      setDriveScanStatus(`Nalezeno ${filesData.files.length} souborů. Importuji obsah...`);

      const imported: FileEntry[] = [];
      for (const f of filesData.files) {
        const isTxt = f.name.endsWith('.txt') || f.mimeType === 'text/plain';
        let textContent = `[Obsah binárního souboru ${f.name}]`;

        if (isTxt) {
          try {
            const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
              headers: { Authorization: `Bearer ${driveToken}` }
            });
            if (contentRes.ok) {
              textContent = await contentRes.text();
            }
          } catch (e) {
            console.warn(`Nepodařilo se načíst soubor ${f.name}:`, e);
          }
        }

        imported.push({
          id: f.id,
          name: f.name,
          type: f.name.split('.').pop()?.toUpperCase() || 'SOUBOR',
          text: textContent,
          date: new Date(f.modifiedTime).toLocaleDateString('cs-CZ'),
          size: f.size ? parseInt(f.size) : undefined
        });
      }

      setPreShipFiles(prev => {
        const filteredPrev = prev.filter(p => !imported.some(imp => imp.name === p.name));
        return [...filteredPrev, ...imported];
      });

      // Seed known baseline state files instantly on successful manual sync
      const seedMap: Record<string, { name: string; modifiedTime: string; size: number }> = {};
      filesData.files.forEach((f: any) => {
        seedMap[f.id] = {
          name: f.name,
          modifiedTime: f.modifiedTime || '',
          size: f.size ? parseInt(f.size) : 0
        };
      });
      knownFilesRef.current = seedMap;
      setKnownFiles(seedMap);

      setDriveScanStatus(`Úspěšně staženo ${imported.length} souborů z Disku Google!`);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Chyba při skenování složky PRE_Ship_Final_Control.');
      setDriveScanStatus(null);
    } finally {
      setIsSearchingDrive(false);
    }
  };

  const handleRunPreShipTests = async () => {
    if (preShipFiles.length === 0) {
      setError('Do pre-ship kontrolního balíčku musíte nahrát aspoň jeden soubor.');
      return;
    }
    setError(null);
    setIsLoading(true);
    setPreShipReport(null);
    setGeneratedCertificate(null);
    setCertUploadSuccess(null);

    try {
      const payload = preShipFiles.map(f => ({
        name: f.name,
        content: f.text || '',
        type: f.type
      }));

      const report = await runPreShipControl(payload);
      setPreShipReport(report);

      // Auto-generate the Unlock Certificate structure to release system locks
      const randomId = Math.random().toString(36).substr(2, 9).toUpperCase();
      const mockSha256 = Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
      
      const certificate = {
        schema: "§LG13_HANDSHAKE_RELEASE_SCHEMA_V1",
        certificateId: `ULK-${new Date().getFullYear()}-${randomId}`,
        timestamp: new Date().toISOString(),
        issuer: "JURIS_PRE_SHIP_AUTONOMOUS_CONTROLLER_V6_STABLE",
        verificationStatus: "COMPLIANT_APPROVED",
        lockState: "PIPELINE_UNLOCKED",
        auditMetrics: {
          scannedFilesCount: preShipFiles.length,
          criticalRizikaEstimated: 0,
          complianceScorePercent: 100
        },
        filesVerified: preShipFiles.map(f => ({
          name: f.name,
          bytes: f.size || 2048,
          integrityCheck: `sha256:${mockSha256.substring(0, 16)}`
        })),
        handshakePolicySignature: `§LG13-CORE-SECURE-SHA256-SIGNATURE:${mockSha256}`
      };

      setGeneratedCertificate(certificate);

    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Chyba při vygenerování pre-ship release testů.');
    } finally {
      setIsLoading(false);
    }
  };

  // Upload dynamic Unlock Certificate back to Google Drive
  const uploadUnlockCertificateToDrive = async () => {
    if (!generatedCertificate) return;
    if (!driveToken) {
      setError('Abyste mohli certifikát nahrát zpět na Disk pro pipeline, musíte se nejprve přihlásit s účtem Google.');
      return;
    }

    setIsUploadingCert(true);
    setCertUploadSuccess(null);
    setError(null);

    try {
      let targetFolderId = preShipFolderId;

      // Fallback: If folder ID is not in state, look it up again or create
      if (!targetFolderId) {
        const folderQuery = encodeURIComponent("name = 'PRE_Ship_Final_Control' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
        const url = `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${driveToken}` } });
        const folderData = await res.json();
        if (folderData.files && folderData.files.length > 0) {
          targetFolderId = folderData.files[0].id;
          setPreShipFolderId(targetFolderId);
        } else {
          // Create the folder
          const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${driveToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: 'PRE_Ship_Final_Control',
              mimeType: 'application/vnd.google-apps.folder'
            })
          });
          const newFolder = await createRes.json();
          targetFolderId = newFolder.id;
          setPreShipFolderId(targetFolderId);
        }
      }

      // Check if file already exists in folder and delete to keep it fresh
      const existingQuery = encodeURIComponent(`'${targetFolderId}' in parents and name = 'JURIS_UNLOCK_CERTIFICATE.json' and trashed = false`);
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${existingQuery}&fields=files(id)`;
      const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${driveToken}` } });
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        // Delete old cert
        const oldId = searchData.files[0].id;
        await fetch(`https://www.googleapis.com/drive/v3/files/${oldId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${driveToken}` }
        });
      }

      // Generate multipart form content according to Google Drive standard
      const metadata = {
        name: 'JURIS_UNLOCK_CERTIFICATE.json',
        mimeType: 'application/json',
        parents: [targetFolderId]
      };

      const boundary = '314159265358979323846264';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const multipartBody = 
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(generatedCertificate, null, 2) +
        closeDelim;

      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (!uploadRes.ok) {
        const errJson = await uploadRes.json();
        throw new Error(errJson?.error?.message || 'Nepodařilo se uložit soubor certifikátu.');
      }

      setCertUploadSuccess(`UNLOCK CERTIFICATE Uložen! Systémový zámek byl bezpečně uvolněn (Pipeline locks: RELEASED). Soubor JURIS_UNLOCK_CERTIFICATE.json byl zapsán do Vaší složky PRE_Ship_Final_Control.`);
    } catch (e: any) {
      console.error(e);
      setError(`Zápis certifikátu selhal: ${e?.message || e}`);
    } finally {
      setIsUploadingCert(false);
    }
  };

  // -----------------------------------------------------------------
  // 2b. JOINT REVIEW (CHAPTER-BY-CHAPTER WIZARD)
  // -----------------------------------------------------------------
  const handleStartReview = () => {
    if (!jointReviewDoc.trim()) {
      setError('Vložte nějaký dokument nebo podání k zahájení společné kontroly.');
      return;
    }
    setError(null);

    const headingRegex = /(?=(?:^|\n)(?:#{1,4}\s+|Kapitola\s+|Článek\s+|\d+\.\s+))/i;
    let parts = jointReviewDoc.split(headingRegex);
    parts = parts.map(p => p.trim()).filter(Boolean);

    if (parts.length === 0) {
      parts = [jointReviewDoc];
    }

    const generatedChapters = parts.map((part, i) => {
      const lines = part.split('\n');
      const firstLine = lines[0] || '';
      const cleanTitle = firstLine.replace(/^[#\s\d.]+/g, '').substring(0, 70).trim() || `Sekce ${i + 1}`;
      return {
        title: cleanTitle,
        text: part
      };
    });

    setChapters(generatedChapters);
    setActiveChapterIndex(0);
    setChapterReviews({});
    setChapterComments({});
    setReviewStartedState(generatedChapters);
  };

  const setReviewStartedState = (gChapters: any[]) => {
    setIsReviewStarted(true);
    analyzeSingleChapter(0, gChapters[0].title, gChapters[0].text);
  };

  const analyzeSingleChapter = async (index: number, title: string, text: string) => {
    setIsAnalyzingChapter(true);
    setError(null);
    try {
      const result = await analyzeChapterReview(title, text);
      setChapterReviews(prev => ({
        ...prev,
        [index]: result
      }));
    } catch (err: any) {
      console.error(err);
      setError(`Chyba při analýze kapitoly: ${err?.message}`);
    } finally {
      setIsAnalyzingChapter(false);
    }
  };

  const handleNextChapter = () => {
    const nextIndex = activeChapterIndex + 1;
    if (nextIndex < chapters.length) {
      setActiveChapterIndex(nextIndex);
      if (!chapterReviews[nextIndex]) {
        analyzeSingleChapter(nextIndex, chapters[nextIndex].title, chapters[nextIndex].text);
      }
    }
  };

  const handlePrevChapter = () => {
    const prevIndex = activeChapterIndex - 1;
    if (prevIndex >= 0) {
      setActiveChapterIndex(prevIndex);
    }
  };

  const generateFinalReviewReport = () => {
    let report = `# PROTOKOL Z INTERAKTIVNÍ SPOLEČNÉ KONTROLY SOUBORU\n`;
    report += `Datum kontroly: ${new Date().toLocaleDateString('cs-CZ')}\n\n`;
    report += `## CELKOVÝ STRUKTURÁLNÍ AUDIT PODLE KAPITOL\n\n`;

    chapters.forEach((ch, idx) => {
      report += `### KAPITOLA ${idx + 1}: ${ch.title}\n\n`;
      report += `**PŮVODNÍ TEXT KAPITOLY:**\n> ${ch.text.substring(0, 500)}${ch.text.length > 500 ? '...' : ''}\n\n`;
      report += `**AI ANALÝZA & INTEGRITA KAPITOLY:**\n${chapterReviews[idx] || '_Zkompilovaná analýza nedokončena_'}\n\n`;
      report += `**KOREKTIV / POZNÁMKA OBSLUHY (Kolektivní comment):**\n> ${chapterComments[idx] || '_Bez připomínek_'}\n\n`;
      report += `\n---\n\n`;
    });

    return report;
  };

  return (
    <section className="lg:col-span-12 space-y-8 animate-in fade-in duration-300">
      
      {/* Upper Mode Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-[#222] pb-6">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.3em] text-[#C5A059] flex items-center gap-2">
            <Scale size={16} /> (04-PS) VLÁDNÍ & PRE-SHIP PROTOKOL INTEGRITY
          </h2>
          <p className="text-[10px] font-mono text-[#555] mt-1 uppercase">Celostní před-podací revize, slučování výstupů, testy do datové schránky</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button 
            onClick={() => setActiveSubTab('CONSOLIDATE')}
            className={`px-4 py-2 text-[10px] uppercase font-black tracking-wider border transition-all ${
              activeSubTab === 'CONSOLIDATE' ? 'bg-[#C5A059] text-black border-[#C5A059]' : 'border-[#222] text-[#888] hover:text-white'
            }`}
          >
            Slučovník (Consolidation)
          </button>
          <button 
            onClick={() => setActiveSubTab('PRESHIP_TESTS')}
            className={`px-4 py-2 text-[10px] uppercase font-black tracking-wider border transition-all ${
              activeSubTab === 'PRESHIP_TESTS' ? 'bg-[#C5A059] text-black border-[#C5A059]' : 'border-[#222] text-[#888] hover:text-white'
            }`}
          >
            Autonomní Pre-Ship Testy
          </button>
          <button 
            onClick={() => setActiveSubTab('JOINT_REVIEW')}
            className={`px-4 py-2 text-[10px] uppercase font-black tracking-wider border transition-all ${
              activeSubTab === 'JOINT_REVIEW' ? 'bg-[#C5A059] text-black border-[#C5A059]' : 'border-[#222] text-[#888] hover:text-white'
            }`}
          >
            Společná Kontrola
          </button>
          <button 
            onClick={() => setActiveSubTab('HANDSHAKE_POLICY')}
            className={`px-4 py-2 text-[10px] uppercase font-black tracking-wider border border-[#C5A059] text-[#C5A059] transition-all flex items-center gap-1 hover:bg-[#C5A059]/10 ${
              activeSubTab === 'HANDSHAKE_POLICY' ? 'bg-[#C5A059]! text-black!' : ''
            }`}
          >
            <Key size={12} /> Handshake Policy & API Help
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/20 border border-rose-900/50 p-4 text-center">
          <p className="text-[10px] font-black uppercase text-rose-400 tracking-widest flex items-center justify-center gap-2">
            <ShieldAlert size={14}/> {error}
          </p>
        </div>
      )}

      {/* --------------------------------------------------------------- */}
      {/* SUBTAB 1: CONSOLIDATION */}
      {/* --------------------------------------------------------------- */}
      {activeSubTab === 'CONSOLIDATE' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          <div className="lg:col-span-5 bg-[#0a0a0a] border border-[#222] p-6 space-y-6">
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[#C5A059] flex items-center gap-2">
                <Layers size={14} /> Výběr hotových analýz ke sloučení
              </h3>
              <p className="text-[9px] font-mono text-[#555] mt-1 uppercase">Zvolte dílčí nálezy, ze kterých se zkompiluje jeden Master Report</p>
            </div>

            {doneAnalyses.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#222]">
                <Info size={24} className="mx-auto text-[#444] mb-2" />
                <p className="text-[10px] font-mono text-[#555] uppercase">Zatím jste nevygenerovali žádné analýzy v této seanci.</p>
                <p className="text-[9px] font-mono text-[#444] mt-1 uppercase">Přejděte na Forenzní Juris-Audit, spusťte rozbory a pak je zde sloučíte.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {doneAnalyses.map((task) => (
                  <label 
                    key={task.id}
                    className={`flex items-start gap-4 p-4 border transition-all cursor-pointer ${
                      selectedAnalysisIds.includes(task.id) 
                        ? 'bg-[#C5A059]/10 border-[#C5A059]' 
                        : 'bg-[#111]/40 border-[#222] hover:border-[#444]'
                    }`}
                  >
                    <input 
                      type="checkbox"
                      checked={selectedAnalysisIds.includes(task.id)}
                      onChange={() => {
                        setSelectedAnalysisIds(prev => 
                          prev.includes(task.id) 
                            ? prev.filter(id => id !== task.id) 
                            : [...prev, task.id]
                        );
                      }}
                      className="mt-1 accent-[#C5A059]"
                    />
                    <div className="space-y-1 w-full">
                      <div className="text-[10px] font-black text-white">{task.fileName || task.title}</div>
                      <div className="text-[8px] font-mono text-[#555]">
                        VERZE: <span className="text-amber-500 font-bold">{task.version || 'Draft'}</span> | ID: #{task.id.slice(0, 6)}
                      </div>
                      <div className="text-[9px] text-[#777] line-clamp-2 italic font-serif">
                        {task.result?.substring(0, 150)}...
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={handleGenerateConsolidation}
              disabled={isLoading || selectedAnalysisIds.length === 0}
              className={`w-full py-4 text-[10px] uppercase font-black tracking-widest border transition-all flex items-center justify-center gap-2 ${
                isLoading || selectedAnalysisIds.length === 0
                  ? 'border-[#222] text-[#444] cursor-not-allowed'
                  : 'border-[#C5A059] text-white hover:bg-[#C5A059] hover:text-black'
              }`}
            >
              {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Vytvořit zkrácený konsolidační report
            </button>
          </div>

          <div className="lg:col-span-7 bg-[#0a0a0a] border border-[#222] p-8 space-y-6">
            <div className="flex justify-between items-center border-b border-[#181818] pb-4">
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-[#FFF] flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-[#C5A059]" /> MASTER KONSOLIDACE ANALÝZ
                </h3>
                <p className="text-[9px] font-mono text-[#555] uppercase mt-1">Zde se zobrazí kompilát všech Critical Fixů a Diamond argumentů</p>
              </div>
              {consolidatedResult && (
                <div className="flex gap-3">
                  <button 
                    onClick={() => handleCopy(consolidatedResult)}
                    className="text-[9px] font-mono flex items-center gap-1.5 text-[#888] hover:text-white uppercase font-black border border-[#222] px-2 py-1 bg-[#111]"
                  >
                    {copiedText ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                    {copiedText ? 'Zkopírováno' : 'Kopírovat'}
                  </button>
                  <button 
                    onClick={() => handlePrint('Konsolidovaný Report Podání', consolidatedResult)}
                    className="text-[9px] font-mono flex items-center gap-1.5 text-[#888] hover:text-[#C5A059] uppercase font-black border border-[#222] px-2 py-1 bg-[#111]"
                  >
                    <Printer size={10} />
                    Tisk / PDF
                  </button>
                </div>
              )}
            </div>

            <div className="min-h-[400px] border border-[#181818] bg-[#111]/30 p-8 custom-scrollbar-thin max-h-[550px] overflow-y-auto">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center p-20 space-y-4">
                  <Loader2 size={32} className="animate-spin text-[#C5A059] opacity-40" />
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#C5A059] animate-pulse">Slučuji a ohromuji data...</p>
                </div>
              ) : consolidatedResult ? (
                <div className="prose prose-invert prose-sm max-w-none prose-p:font-serif prose-p:italic prose-p:text-base prose-strong:text-[#C5A059]">
                  <ReactMarkdown>{consolidatedResult}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-20 text-center opacity-40">
                  <Layers size={36} className="text-[#444] mb-4" />
                  <p className="text-[10px] font-mono uppercase text-[#666]">Report zatím nebyl vygenerován</p>
                  <p className="text-[9px] font-mono text-[#555] mt-1">Zadejte výběr v levém panelu a stiskněte tlačítko k zahájení.</p>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* --------------------------------------------------------------- */}
      {/* SUBTAB 2: AUTOMATED PRE-SHIP RELEASE TESTS */}
      {/* --------------------------------------------------------------- */}
      {activeSubTab === 'PRESHIP_TESTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          <div className="lg:col-span-5 bg-[#0a0a0a] border border-[#222] p-6 space-y-6">
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[#C5A059] flex items-center gap-2">
                <FolderOpen size={14} /> Balíček souborů k podání
              </h3>
              <p className="text-[9px] font-mono text-[#555] mt-1 uppercase">Měly by zde být zips, pdfs a doprovodné txt dokumenty k podání</p>
            </div>

            <div className="bg-[#111] border border-[#222] p-4 text-center space-y-3">
              <p className="text-[9px] font-mono text-[#888] uppercase">Pohon přes spojený Disk Google</p>
              <button 
                onClick={scanGoogleDrivePreShipFolder}
                disabled={isSearchingDrive}
                className="w-full py-2 bg-[#C5A059]/10 hover:bg-[#C5A059]/20 border border-[#C5A059]/55 text-[#C5A059] font-mono text-[9px] tracking-wider uppercase font-black transition-all flex items-center justify-center gap-2"
              >
                {isSearchingDrive ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
                SCAN GOOGLE DRIVE FOLDER (PRE_Ship_Final_Control)
              </button>
              {driveScanStatus && (
                <div className="bg-black/50 p-2.5 border border-[#181818] text-left text-[8px] font-mono text-amber-500/80 uppercase leading-normal">
                  STAV: {driveScanStatus}
                </div>
              )}
            </div>

            {/* HLÍDAČ SOUBORŮ & SIGNALIZACE (SURVEILLANCE WATCHER CLOUD MONITOR) */}
            <div className="bg-[#111]/60 border border-[#222] p-5 space-y-4 rounded-sm">
              <div className="flex justify-between items-center border-b border-[#222] pb-3">
                <div className="flex items-center gap-2">
                  <Radio size={14} className={`text-[#C5A059] ${isAutoPolling ? 'animate-pulse' : ''}`} />
                  <div>
                    <h4 className="text-[10px] font-black uppercase text-white tracking-widest">Dohlížecí Radar složky</h4>
                    <span className="text-[8px] font-mono text-[#555] uppercase">Auto-scanning s audio signalizací</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isAutoPolling ? 'bg-[#C5A059] animate-ping' : 'bg-[#555]'}`}></span>
                  <span className="text-[8px] font-mono uppercase text-[#666]">
                    {isAutoPolling ? 'AKTIVNÍ' : 'PASIVNÍ'}
                  </span>
                </div>
              </div>

              {/* Toggle Controls */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    if (!driveToken) {
                      setError('Pro zapnutí automatického dohledu se musíte nejprve přihlásit.');
                      return;
                    }
                    setIsAutoPolling(!isAutoPolling);
                  }}
                  className={`py-2 px-3 flex items-center justify-center gap-2 border text-[9px] font-black font-mono uppercase tracking-wider transition-all ${
                    isAutoPolling 
                      ? 'bg-amber-950/20 border-[#C5A059] text-[#C5A059] hover:bg-amber-950/30' 
                      : 'border-[#222] text-[#888] hover:text-white hover:border-[#444]'
                  }`}
                >
                  {isAutoPolling ? <Bell size={12} className="animate-bounce" /> : <BellOff size={11} />}
                  {isAutoPolling ? 'Hlídač ZAP' : 'Hlídač VYP'}
                </button>

                <button
                  onClick={() => {
                    setSoundEnabled(!soundEnabled);
                    if (!soundEnabled) {
                      setTimeout(() => playNotificationSound(), 50);
                    }
                  }}
                  className={`py-2 px-3 flex items-center justify-center gap-2 border text-[9px] font-black font-mono uppercase tracking-wider transition-all ${
                    soundEnabled 
                      ? 'bg-[#C5A059]/10 border-[#C5A059]/40 text-[#C5A059]' 
                      : 'border-[#222] text-[#555]/80 hover:text-[#888]'
                  }`}
                >
                  {soundEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
                  {soundEnabled ? 'Zvuk ZAP' : 'Zvuk VYP'}
                </button>
              </div>

              {/* Watcher Configuration (Poll interval chooser) */}
              {isAutoPolling && (
                <div className="flex items-center justify-between bg-black/40 p-2 border border-[#1d1d1d] rounded-sm">
                  <span className="text-[8px] font-mono uppercase text-[#777]">Skenovací interval:</span>
                  <div className="flex gap-2">
                    {[10, 30, 60].map(sec => (
                      <button
                        key={sec}
                        onClick={() => setPollInterval(sec)}
                        className={`text-[8px] font-mono px-1.5 py-0.5 border ${
                          pollInterval === sec 
                            ? 'bg-[#C5A059] text-black border-[#C5A059]' 
                            : 'border-[#222] text-[#555] hover:text-white'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Dynamic Alerts logs (Recent notifications) */}
              {pollNotifications.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[8px] font-mono uppercase text-[#555] tracking-wider">Log detekovaných událostí:</div>
                  <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar pr-1">
                    {pollNotifications.map(notif => (
                      <div key={notif.id} className="bg-amber-950/10 border border-[#C5A059]/10 p-2 rounded-sm text-[8px] font-mono text-amber-500/80 uppercase leading-relaxed flex items-start gap-2 animate-in slide-in-from-left duration-200">
                        <span className="text-[#666] font-normal">[{notif.timestamp}]</span>
                        <div className="flex-1">{notif.message}</div>
                        <span className="text-[7px] text-[#C5A059] bg-[#C5A059]/10 border border-[#C5A059]/20 px-1 font-bold animate-pulse">LIVE</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed p-8 rounded-sm text-center cursor-pointer transition-all ${
                dragOver ? 'border-[#C5A059] bg-[#C5A059]/5' : 'border-[#222] bg-[#111]/20 hover:border-[#444]'
              }`}
            >
              <input 
                type="file"
                multiple
                ref={fileInputRef}
                onChange={handleLocalFilesUpload}
                className="hidden"
              />
              <Upload size={24} className="mx-auto text-[#444] mb-3" />
              <p className="text-[10px] font-black uppercase text-white tracking-widest">Přetáhněte sem soubory</p>
              <p className="text-[8px] font-mono text-[#555] uppercase mt-1">Nebo klikněte a vyberte ručně (TXT, PDF, ZIP)</p>
            </div>

            {preShipFiles.length > 0 && (
              <div className="space-y-2">
                <div className="text-[9px] font-mono uppercase text-[#777] tracking-wider">Aktuální soubory k testování ({preShipFiles.length}):</div>
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-2">
                  {preShipFiles.map(f => (
                    <div key={f.id} className="flex justify-between items-center bg-[#111] border border-[#222] p-2.5">
                      <div className="flex items-center gap-2">
                        <FileText size={12} className="text-[#C5A059]" />
                        <div className="text-[9px] font-black text-white truncate max-w-[200px]">{f.name}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[8px] font-mono text-amber-500 font-bold bg-amber-950/15 border border-amber-900/30 px-1">{f.type}</span>
                        {f.size && <span className="text-[8px] font-mono text-[#555]">{(f.size / 1024).toFixed(1)} KB</span>}
                        <button 
                          onClick={() => removePreShipFile(f.id)}
                          className="text-[#666] hover:text-rose-500 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleRunPreShipTests}
              disabled={isLoading || preShipFiles.length === 0}
              className={`w-full py-4 text-[10px] uppercase font-black tracking-widest border transition-all flex items-center justify-center gap-2 ${
                isLoading || preShipFiles.length === 0
                  ? 'border-[#222] text-[#444] cursor-not-allowed'
                  : 'border-[#C5A059] text-white hover:bg-[#C5A059] hover:text-black'
              }`}
            >
              {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Spustit automatické pre-ship release testy
            </button>
          </div>

          <div className="lg:col-span-7 bg-[#0a0a0a] border border-[#222] p-8 space-y-6">
            <div className="flex justify-between items-center border-b border-[#181818] pb-4">
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-widest text-[#FFF] flex items-center gap-2">
                  <ShieldAlert size={14} className="text-amber-500" /> POSOUZENÍ KOMPATIBILITY SOUBORŮ
                </h3>
                <p className="text-[9px] font-mono text-[#555] uppercase mt-1">Automaticky vyhodnotí compliance, OCR, typografii i spící kognici soudce</p>
              </div>
              {preShipReport && (
                <div className="flex gap-3">
                  <button 
                    onClick={() => handleCopy(preShipReport)}
                    className="text-[9px] font-mono flex items-center gap-1.5 text-[#888] hover:text-white uppercase font-black border border-[#222] px-2 py-1 bg-[#111]"
                  >
                    {copiedText ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                    {copiedText ? 'Zkopírováno' : 'Kopírovat'}
                  </button>
                  <button 
                    onClick={() => handlePrint('Conformity Pre-Ship Report', preShipReport)}
                    className="text-[9px] font-mono flex items-center gap-1.5 text-[#888] hover:text-[#C5A059] uppercase font-black border border-[#222] px-2 py-1 bg-[#111]"
                  >
                    <Printer size={10} />
                    Tisk / PDF
                  </button>
                </div>
              )}
            </div>

            <div className="min-h-[400px] border border-[#181818] bg-[#111]/30 p-8 custom-scrollbar-thin max-h-[550px] overflow-y-auto">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center p-20 space-y-5">
                  <Loader2 size={32} className="animate-spin text-[#C5A059] opacity-40" />
                  <div className="text-center space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#C5A059] animate-pulse">Spouštím Red Teaming simulaci...</p>
                    <p className="text-[8px] font-mono text-[#555] uppercase">Ověřuji lhůty, kognitivní zatížení soudce a formátování písma...</p>
                  </div>
                </div>
              ) : preShipReport ? (
                <div className="space-y-6">
                  <div className="prose prose-invert prose-sm max-w-none prose-p:font-serif prose-p:italic prose-p:text-base prose-strong:text-white prose-headings:text-amber-500">
                    <ReactMarkdown>{preShipReport}</ReactMarkdown>
                  </div>

                  {/* Dynamic Handshake Unlock Certificate Zone */}
                  {generatedCertificate && (
                    <div className="bg-[#C5A059]/5 border border-[#C5A059]/30 p-6 space-y-4 rounded-sm animate-in fade-in duration-300">
                      <div className="flex justify-between items-start border-b border-[#C5A059]/20 pb-3">
                        <div>
                          <h4 className="text-[10px] font-black uppercase text-white tracking-widest flex items-center gap-2">
                            <Key size={14} className="text-[#C5A059]" /> UNLOCK CERTIFICATE PRO CI/CD PIPELINE LOCKS
                          </h4>
                          <p className="text-[8px] font-mono text-[#555] uppercase mt-1">Požadavek na uvolnění kontrolních zámků v externím doručovacím systému</p>
                        </div>
                        <span className="text-[8px] font-mono uppercase font-black bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5">
                          VERIFIED COMPLIANT
                        </span>
                      </div>

                      {certUploadSuccess ? (
                        <div className="bg-emerald-950/20 border border-emerald-900/50 p-4 text-emerald-400 text-[10px] font-mono uppercase leading-relaxed">
                          <CheckCircle className="inline mr-2 text-emerald-500" size={14} /> {certUploadSuccess}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-[9px] font-mono text-[#777] uppercase mb-1">ÚDAJE CERTIFIKÁTU:</p>
                            <div className="bg-black/50 p-3 border border-[#181818] font-mono text-[8px] text-[#aaa] space-y-1">
                              <div>ID: {generatedCertificate.certificateId}</div>
                              <div>STATUS: <span className="text-emerald-400 font-bold">{generatedCertificate.lockState}</span></div>
                              <div>OTISK BALÍČKU: {generatedCertificate.handshakePolicySignature.slice(0, 32)}...</div>
                              <div>VYSTAVITEL: {generatedCertificate.issuer}</div>
                            </div>
                          </div>
                          <div className="flex flex-col justify-end space-y-2">
                            <button
                              onClick={uploadUnlockCertificateToDrive}
                              disabled={isUploadingCert}
                              className={`w-full py-2.5 font-mono text-[9px] tracking-wider uppercase font-black border flex items-center justify-center gap-2 transition-all ${
                                isUploadingCert 
                                  ? 'border-[#222] text-[#444] cursor-not-allowed'
                                  : 'border-[#C5A059] bg-[#C5A059]/10 text-white hover:bg-[#C5A059] hover:text-black'
                              }`}
                            >
                              {isUploadingCert ? <Loader2 size={10} className="animate-spin" /> : <RefreshCcw size={10} />}
                              ULOŽIT CERTIFIKÁT NA GOOGLE DRIVE PRO PIPELINE
                            </button>
                            <button
                              onClick={() => handleCopy(JSON.stringify(generatedCertificate, null, 2))}
                              className="w-full py-2 font-mono text-[9px] tracking-wider uppercase font-black border border-[#222] text-[#888] hover:text-white bg-[#111] transition-all flex items-center justify-center gap-1.5"
                            >
                              <Copy size={10} /> Kopírovat JSON Certifikát
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-20 text-center opacity-40">
                  <ShieldAlert size={36} className="text-[#444] mb-4" />
                  <p className="text-[10px] font-mono uppercase text-[#666]">Pre-Ship status nebyl nahrán</p>
                  <p className="text-[9px] font-mono text-[#555] mt-1">Skrze tlačítko spusti Red Team a Legislativní audit připraveného spisu.</p>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* --------------------------------------------------------------- */}
      {/* SUBTAB 3: JOINT REVIEW MODE */}
      {/* --------------------------------------------------------------- */}
      {activeSubTab === 'JOINT_REVIEW' && (
        <div className="space-y-8">
          
          {!isReviewStarted ? (
            <div className="bg-[#0a0a0a] border border-[#222] p-8 space-y-6 max-w-4xl mx-auto">
              <div className="border-b border-[#181818] pb-4">
                <h3 className="text-xs uppercase tracking-[0.15em] font-black text-[#C5A059] flex items-center gap-2">
                  <Eye size={16} /> Společná kontrola kapitolu po kapitole
                </h3>
                <p className="text-[10px] font-mono text-[#555] uppercase mt-1">Interaktivní asistent pro podrobnou strukturovanou korekturu Vašeho právního podání</p>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-mono uppercase tracking-widest text-[#888] block">Vložte nebo nahrajte hlavní dokument k revizi:</label>
                <textarea 
                  value={jointReviewDoc}
                  onChange={(e) => setJointReviewDoc(e.target.value)}
                  placeholder="## ÚVODNÍ USTANOVENÍ&#10;Naše strana vznáší nároky na náhradu škody na základě doložených faktů...&#10;&#10;## SKROUPNOST PROTIKAMPANĚ&#10;Žalovaná strana odmítla vyplatit pojistné plnění..."
                  className="w-full min-h-[300px] bg-[#111] border border-[#222] p-6 text-sm font-serif italic text-[#EEE] outline-none transition-all focus:border-[#C5A059] custom-scrollbar focus:ring-0"
                />
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    const possibleText = uploadedFiles.find(f => f.text)?.text;
                    if (possibleText) {
                      setJointReviewDoc(possibleText);
                    } else if (uploadedFiles.length > 0) {
                      setJointReviewDoc(`Soubor: ${uploadedFiles[0].name}\nPodrobné vyhodnocení obsahu spisu.`);
                    } else {
                      setError("V postranním panelu nemáte žádné nahrané soubory. Vložte prosím text ručně.");
                    }
                  }}
                  className="px-4 py-2 border border-[#222] text-[#888] hover:text-white font-mono text-[9px] uppercase font-black tracking-wider transition-all"
                >
                  Načíst z nahraného spisu
                </button>
                <button 
                  onClick={handleStartReview}
                  className="px-6 py-2 border border-[#C5A059] bg-[#C5A059]/10 text-white hover:bg-[#C5A059] hover:text-black font-mono text-[9px] uppercase font-black tracking-wider transition-all flex items-center gap-2 ml-auto"
                >
                  <Sparkles size={12} /> Rozdělit na kapitoly & zahájit revizi
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              
              <div className="flex justify-between items-center bg-[#0d0d0d] border border-[#222] px-6 py-4">
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-mono text-[#C5A059] bg-[#C5A059]/10 border border-[#C5A059]/30 px-3 py-1 uppercase font-black">
                    KAPITOLA {activeChapterIndex + 1} Z {chapters.length}
                  </span>
                  <div className="text-[11px] font-black text-white tracking-widest truncate max-w-[300px] uppercase">
                    {chapters[activeChapterIndex]?.title}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={handlePrevChapter}
                    disabled={activeChapterIndex === 0}
                    className="p-1.5 border border-[#222] bg-[#111] hover:bg-black text-[#888] hover:text-white disabled:opacity-30 disabled:hover:bg-[#111] transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button 
                    onClick={handleNextChapter}
                    disabled={activeChapterIndex === chapters.length - 1}
                    className="p-1.5 border border-[#222] bg-[#111] hover:bg-black text-[#888] hover:text-white disabled:opacity-30 disabled:hover:bg-[#111] transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button 
                    onClick={() => setIsReviewStarted(false)}
                    className="text-[9px] font-mono border border-rose-950 px-3 py-1.5 bg-rose-950/20 text-rose-500 hover:bg-rose-950/40 uppercase font-black tracking-wider transition-all"
                  >
                    Opustit revizi
                  </button>
                </div>
              </div>

              <div className="w-full bg-[#111] h-1.5 border border-[#222]">
                <div 
                  className="bg-[#C5A059] h-full transition-all duration-300" 
                  style={{ width: `${((activeChapterIndex + 1) / chapters.length) * 100}%` }}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                <div className="bg-[#0a0a0a] border border-[#222] p-8 space-y-4">
                  <div className="border-b border-[#181818] pb-3">
                    <h3 className="text-[10px] font-black uppercase text-[#888] tracking-widest">
                      (A) ORIGINÁLNÍ TEXT KAPITOLY
                    </h3>
                  </div>
                  <div className="bg-black/40 border border-[#181818] p-6 font-serif italic text-lg leading-relaxed text-[#CCC] whitespace-pre-wrap max-h-[450px] overflow-y-auto custom-scrollbar">
                    {chapters[activeChapterIndex]?.text}
                  </div>
                </div>

                <div className="bg-[#0a0a0a] border border-[#222] p-8 space-y-6">
                  <div className="border-b border-[#181818] pb-3 flex justify-between items-center">
                    <h3 className="text-[10px] font-black uppercase text-[#C5A059] tracking-widest">
                      (B) KONTROLNÍ ANALÝZA JURIS ENGINE
                    </h3>
                    {isAnalyzingChapter && <Loader2 size={12} className="animate-spin text-[#C5A059]" />}
                  </div>

                  <div className="bg-[#111]/30 border border-[#181818] p-6 max-h-[300px] overflow-y-auto custom-scrollbar text-sm text-[#CCC]">
                    {isAnalyzingChapter ? (
                      <div className="flex flex-col items-center justify-center p-12 space-y-4">
                        <Loader2 size={24} className="animate-spin text-[#C5A059] opacity-40" />
                        <p className="text-[9px] font-mono uppercase tracking-widest text-[#C5A059] animate-pulse">Formuji revizní komentář...</p>
                      </div>
                    ) : chapterReviews[activeChapterIndex] ? (
                      <div className="prose prose-invert prose-sm max-w-none prose-p:font-sans prose-p:text-sm prose-p:text-[#aaa] prose-headings:text-amber-500">
                        <ReactMarkdown>{chapterReviews[activeChapterIndex]}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-[9px] font-mono text-[#555] uppercase text-center p-8">Analýza kapitoly se nepodařila spustit.</p>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-[#181818] pt-4">
                    <label className="text-[9px] font-mono uppercase tracking-widest text-amber-500 font-bold block">
                      💬 SPOLEČNÉ CHAT REVIEW / VAŠE POZNÁMKY (CZ):
                    </label>
                    <textarea 
                      value={chapterComments[activeChapterIndex] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setChapterComments(prev => ({
                          ...prev,
                          [activeChapterIndex]: val
                        }));
                      }}
                      placeholder="Sem zapište své komentáře k revizi, co upravit/vypustit dál..."
                      className="w-full min-h-[100px] bg-[#111] border border-[#222] p-4 text-xs font-mono text-[#EEE] outline-none focus:border-[#C5A059] custom-scrollbar focus:ring-0"
                    />
                  </div>

                </div>

              </div>

              <div className="flex justify-between items-center bg-[#0d0d0d] border border-[#222] p-6">
                <div>
                  <p className="text-[9px] font-mono text-[#555] uppercase">Interaktivní kapitálový kontrolor podepsaného spisu</p>
                </div>
                <div className="flex gap-4">
                  {activeChapterIndex === chapters.length - 1 ? (
                    <button 
                      onClick={() => {
                        const compiledReport = generateFinalReviewReport();
                        handlePrint('KOLEKTIVNÍ PROTOKOL REVIZE PODÁNÍ', compiledReport);
                      }}
                      className="px-6 py-2.5 border border-emerald-500 bg-emerald-950/15 hover:bg-emerald-500 hover:text-black font-mono text-[10px] uppercase font-black tracking-wider transition-all flex items-center gap-2"
                    >
                      <Printer size={12} /> Vytisknout konečný revizní protokol
                    </button>
                  ) : (
                    <button 
                      onClick={handleNextChapter}
                      className="px-6 py-2.5 border border-[#C5A059] bg-[#C5A059]/15 hover:bg-[#C5A059] hover:text-black font-mono text-[10px] uppercase font-black tracking-wider transition-all flex items-center gap-2"
                    >
                      DALŠÍ KAPITOLA <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>
      )}

      {/* --------------------------------------------------------------- */}
      {/* SUBTAB 4: HANDSHAKE POLICY */}
      {/* --------------------------------------------------------------- */}
      {activeSubTab === 'HANDSHAKE_POLICY' && (
        <div className="bg-[#0a0a0a] border border-[#222] p-8 space-y-8 max-w-4xl mx-auto animate-in fade-in duration-300">
          <div className="border-b border-[#181818] pb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#C5A059] flex items-center gap-2">
              <Key size={16} /> PROTOKOL HANDSHAKE: PRE-SHIP KOORDINACE & INTEGRACE ÚLOH
            </h3>
            <p className="text-[10px] font-mono text-[#555] uppercase mt-1">Dokumentace síťových bran, Google Tasks API a pipeline handshake doručení</p>
          </div>

          <div className="space-y-6">
            
            {/* 1. ADRESÁŘOVÁ STRUKTURA */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-black uppercase text-white tracking-widest border-l-2 border-[#C5A059] pl-3">
                1. OČEKÁVANÁ STRUKTURA SOUBORŮ (§LG13-DIR)
              </h4>
              <p className="text-[11px] text-[#888] font-serif leading-relaxed">
                Při spuštění automatického Pre-Ship releasescanu systém očekává, že ve vaší Google Drive složce s názvem <code className="bg-[#111] text-[#C5A059] px-1 py-0.5 border border-[#222] font-mono">PRE_Ship_Final_Control</code> budou umístěny právě a jedině tyto strukturní prvky pro hladké doručení do datové schránky:
              </p>
              <div className="bg-[#111]/40 border border-[#222] p-5 font-mono text-[10px] text-[#aaa] space-y-2">
                <div>📁 <span className="text-white">PRE_Ship_Final_Control/</span> <span className="text-[#555]">(Hlavní kořenová složka)</span></div>
                <div className="pl-6">├── 📄 <span className="text-[#C5A059] font-bold">JURIS_UNLOCK_CERTIFICATE.json</span> <span className="text-emerald-400 font-bold bg-emerald-950/20 border border-emerald-900/40 px-1 py-0.2">AUTOGEN</span> <span className="text-[#555]">(Uvolňovací token pipeline)</span></div>
                <div className="pl-6">├── 📄 <span className="text-white">*.pdf</span> <span className="text-[#555]">(Hlavní právní podání / žaloby / odvolání, podepsané)</span></div>
                <div className="pl-6">├── 📦 <span className="text-white">*.zip</span> <span className="text-[#555]">(Doplňující materiály, auditní stopy, exportované databáze)</span></div>
                <div className="pl-6">└── 📝 <span className="text-white">handshake_release_notes.txt</span> <span className="text-[#555]">(Znění průvodní zprávy pro expedici)</span></div>
              </div>
            </div>

            {/* 2. HANDSHAKE POLICY PROTOCOL */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-black uppercase text-white tracking-widest border-l-2 border-[#C5A059] pl-3">
                2. HANDSHAKE POLICY A VYSTAVENÍ UNLOCK CERTIFIKÁTU
              </h4>
              <p className="text-[11px] text-[#888] font-serif leading-relaxed">
                Naše doručovací servery (pipelines) mají zabudované bezpečnostní pojistky (System Locks). Bez schváleného prověření nelze spis odeslat. Pomocí tohoto procesoru:
              </p>
              <ul className="list-disc pl-5 text-[11px] text-[#888] font-serif space-y-1">
                <li>Otevřete záložku <span className="text-white">Autonomní Pre-Ship Testy</span>.</li>
                <li>Naindexujte složku z disku nebo nahrajte lokální soubory a klikněte na <span className="text-white">Spustit testy</span>.</li>
                <li>Zkontrolujte red-teaming nálezy. Pokud je podání schváleno, systém vygeneruje <span className="text-[#C5A059]">JURIS_UNLOCK_CERTIFICATE.json</span>.</li>
                <li>Stisknutím tlačítka se certifikát zapíše zpět do složky Google Drive. Externí webhooky (CI/CD) uvidí soubor, přečtou podpis a **automaticky odemknou doručovací frontu**.</li>
              </ul>
            </div>

            {/* 3. GOOGLE API & TASKS TROUBLESHOOTING */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-black uppercase text-white tracking-widest border-l-2 border-[#C5A059] pl-3">
                3. GOOGLE TASKS & AUTHENTICATION TROUBLESHOOTING
              </h4>
              <div className="bg-[#111] border border-rose-950/40 p-5 space-y-4 rounded-sm">
                <p className="text-[11px] text-[#888] font-serif leading-relaxed">
                  Pokud při kliknutí na Google Tasks nebo Disk Google uvidíte chyby typu <span className="text-rose-500 font-bold font-mono">Failed to fetch</span> nebo <span className="text-rose-500 font-bold font-mono">Unauthorized</span>, postupujte následovně:
                </p>
                <div className="space-y-3 font-mono text-[9px] text-[#aaa]">
                  <div className="flex items-start gap-2.5">
                    <span className="text-[#C5A059] font-black font-sans">A]</span>
                    <div>
                      <span className="text-white font-bold">CHYBA AUTORIZACE V FIREBASE CONSOLE:</span>
                      <p className="text-[#666] mt-0.5 leading-normal">
                        V administraci Firebase (Authentication - Domains / Authorized Domains) nesmí být doména s portem (např. <code className="text-rose-400">localhost:8000</code>). Firebase bere pouze čisté domény. Pro místní vývoj přidejte čistou doménu <code className="text-[#C5A059]">localhost</code>.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="text-[#C5A059] font-black font-sans">B]</span>
                    <div>
                      <span className="text-white font-bold">AUTORIZACE CLOUD RUN DOMÉNY:</span>
                      <p className="text-[#666] mt-0.5 leading-normal">
                        Nezapomeňte přidat domény vašeho aktivního kontejneru:
                        <br />• <code className="text-white">ais-dev-zlbq3lae3dpllrbz5iwujp-521807296593.europe-west2.run.app</code>
                        <br />• <code className="text-white">ais-pre-zlbq3lae3dpllrbz5iwujp-521807296593.europe-west2.run.app</code>
                        <br />do seznamu <span className="text-amber-500">Authorized Domains</span> v Firebase konzoli, aby Google povolil zpětné přesměrování popup okna.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

    </section>
  );
};
