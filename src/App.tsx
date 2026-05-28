import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Scale, Send, FileText, CheckCircle2, AlertCircle, RefreshCcw, Loader2, 
  Sparkles, Copy, Check, Upload, X, FileJson, Archive, Download, Eye, 
  FileDown, Trash2, FolderArchive, RotateCcw, ListFilter, History,
  LayoutGrid, Layers, ShieldCheck, Gauge, Scissors, Diff, Paperclip, Plus,
  LogOut, LogIn, Database, Cloud, FolderOpen, Link2, TrendingUp
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, 
  CartesianGrid, Legend, BarChart, Bar, AreaChart, Area 
} from 'recharts';
import { reviewCourtRequest } from './services/gemini';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { PreShipControlView } from './components/PreShipControlView';
import { 
  getOrCreateJurisTaskList, fetchJurisTasks, createJurisTask, 
  completeJurisTask, deleteJurisTask, GoogleTask 
} from './services/googleTasks';
import { cn } from './lib/utils';
import { auth, db, googleProvider, signInWithPopup } from './lib/firebase';
import { onAuthStateChanged, signOut, User, GoogleAuthProvider } from 'firebase/auth';
import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, 
  deleteDoc, query, where, onSnapshot, writeBatch,
  getDocFromServer
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw to avoid crashing the whole app, but we log it
}

interface FileEntry {
  id: string;
  name: string;
  type: string;
  category: 'MAIN' | 'ATTACH' | 'SUPPORT' | 'SYSTEM' | string;
  isUploaded?: boolean;
  isArchived?: boolean;
  timestamp: number;
  batchId?: string;
  version?: string;
  caseId?: string;
  content?: string; 
  insight?: string; // Pre-analysis result
  indexStatus?: 'IDLE' | 'INDEXING' | 'DONE' | 'ERROR';
  driveFolderId?: string;
  driveFileId?: string;
}

interface CaseRecord {
  id: string;
  name: string;
  nr: string;
  activeVersion: string;
}

interface AuditTask {
  id: string;
  files: string[];
  supportFiles: string[];
  pillars: string[];
  status: 'pending' | 'processing' | 'done';
  timestamp: number;
  result?: string;
  isNotified?: boolean;
  version?: string;
  title?: string;
  caseId?: string;
}

interface VersionRecord {
  id: string;
  version: string;
  text: string;
  timestamp: number;
  selectedFiles: string[];
  selectedPillars: string[];
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [currentVersion, setCurrentVersion] = useState('F15.5');
  const [history, setHistory] = useState<VersionRecord[]>([]);
  const [compareVersionIds, setCompareVersionIds] = useState<string[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'MD' | 'JSON' | 'HTML'>('HTML');
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<FileEntry[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [supportFileIds, setSupportFileIds] = useState<string[]>([]);
  const [selectedPillarIds, setSelectedPillarIds] = useState<string[]>(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14']);
  const [fileSearch, setFileSearch] = useState('');
  const [versionFilter, setVersionFilter] = useState<'ALL' | 'CURRENT' | 'ORPHAN' | string>('ALL');
  const [fileSortBy, setFileSortBy] = useState<'id' | 'name' | 'type' | 'date' | 'batch' | 'ORDER'>('ORDER');
  const [showArchived, setShowArchived] = useState(false);
  const [auditQueue, setAuditQueue] = useState<AuditTask[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [queueStrategy, setQueueStrategy] = useState<'COMBINE' | 'PER_FILE' | 'CROSS'>('COMBINE');
  const [appMode, setAppMode] = useState<'AUDIT' | 'COMPOSE' | 'VERTICAL' | 'SYNTHESIS' | 'DASHBOARD' | 'PRE_SHIP'>('AUDIT');
  const [isAutoIndexingEnabled, setIsAutoIndexingEnabled] = useState<boolean>(true);
  const [quotaCountdown, setQuotaCountdown] = useState<number>(0);

  useEffect(() => {
    if (quotaCountdown <= 0) return;
    const interval = setInterval(() => {
      setQuotaCountdown(prev => {
        if (prev <= 1) {
          setIsAutoIndexingEnabled(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [quotaCountdown]);

  const [activeAutoImports, setActiveAutoImports] = useState<{id: string, name: string, status: string}[]>([]);
  const [uploadBatchId, setUploadBatchId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [notes, setNotes] = useState('');
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [newCaseData, setNewCaseData] = useState({ name: '', nr: '' });
  const [selectionMode, setSelectionMode] = useState<'FILES' | 'VERSIONS'>('FILES');
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [currentProcessingId, setCurrentProcessingId] = useState<string | null>(null);
  const [gitContext, setGitContext] = useState('https://github.com/LG13-21/lg13-build-from-atoms');
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [isFirebaseOffline, setIsFirebaseOffline] = useState(false);
  const [isFirebaseQuotaExceeded, setIsFirebaseQuotaExceeded] = useState(false);
  const [fixAnalysisText, setFixAnalysisText] = useState<string | null>(null);
  const [isGeneratingFixAnalysis, setIsGeneratingFixAnalysis] = useState(false);
  const [isGeneratingUpgrade, setIsGeneratingUpgrade] = useState(false);

  // Google Drive Integration States
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [driveSearchQuery, setDriveSearchQuery] = useState('');
  const [driveUrlInput, setDriveUrlInput] = useState('');
  const [currentDriveFolderId, setCurrentDriveFolderId] = useState<string>('root');
  const [driveFolderHistory, setDriveFolderHistory] = useState<{ id: string; name: string }[]>([]);
  const [isImportingFolder, setIsImportingFolder] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isSavingAnalysisToDrive, setIsSavingAnalysisToDrive] = useState(false);

  // High-priority and background imports for Google Drive
  const [driveFoldersToImportPrompt, setDriveFoldersToImportPrompt] = useState<{ id: string; name: string; selected: boolean }[] | null>(null);
  const [backgroundImportQueue, setBackgroundImportQueue] = useState<{ id: string; name: string }[]>([]);
  const [priorityImportIds, setPriorityImportIds] = useState<Set<string>>(new Set());
  const [backgroundImportStarted, setBackgroundImportStarted] = useState<boolean>(false);

  // Google Tasks Integration States
  const [googleTasksListId, setGoogleTasksListId] = useState<string | null>(null);
  const [googleTasks, setGoogleTasks] = useState<GoogleTask[]>([]);
  const [isFetchingTasks, setIsFetchingTasks] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [successTaskMessage, setSuccessTaskMessage] = useState<string | null>(null);

  // Bezpečný a plně interaktivní in-app potvrzovací dialog (nahrazuje window.confirm náchylný k chybám v iframe)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const isResetting = useRef(false);
  const isLoaded = useRef(false);
  const stopRequestedRef = useRef(false);

  // Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthLoading(false);
      if (!u) {
        setDriveToken(null);
        setGoogleTasksListId(null);
        setGoogleTasks([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Synchronizace s Google Tasks při detekci tokenu
  useEffect(() => {
    if (driveToken) {
      fetchTasksFromGoogle(driveToken);
    } else {
      setGoogleTasksListId(null);
      setGoogleTasks([]);
    }
  }, [driveToken]);

  const fetchTasksFromGoogle = async (token: string) => {
    setIsFetchingTasks(true);
    setTasksError(null);
    try {
      const listId = await getOrCreateJurisTaskList(token);
      setGoogleTasksListId(listId);
      const tasks = await fetchJurisTasks(token, listId);
      setGoogleTasks(tasks);
    } catch (e: any) {
      console.error('Failed to sync with Google Tasks:', e);
      setTasksError(e.message || 'Nepodařilo se připojit k Google Tasks.');
    } finally {
      setIsFetchingTasks(false);
    }
  };

  const syncGoogleTasksNow = () => {
    if (driveToken) {
      fetchTasksFromGoogle(driveToken);
    }
  };

  const createGoogleTaskQuick = async (title: string, notes?: string) => {
    if (!driveToken || !googleTasksListId) return;
    setIsCreatingTask(true);
    try {
      await createJurisTask(driveToken, googleTasksListId, title, notes);
      setSuccessTaskMessage('Úkol byl úspěšně vytvořen v Google Tasks.');
      await fetchTasksFromGoogle(driveToken);
      setTimeout(() => setSuccessTaskMessage(null), 4000);
    } catch (e: any) {
      alert(`Nepodařilo se vytvořit úkol: ${e.message}`);
    } finally {
      setIsCreatingTask(false);
    }
  };

  const exportAuditToGoogleTasks = async (queueItem: AuditTask) => {
    if (!driveToken || !googleTasksListId) {
      alert("Pro exportování je nutné se nejprve přihlásit a zprovoznit Google Tasks.");
      return;
    }
    setIsCreatingTask(true);
    try {
      const title = `AUDIT: [${queueItem.version || 'Draft'}] ${queueItem.files[0] || 'Bez souboru'}`;
      const notes = `Verze spisu: ${queueItem.version || 'Neznámá'}
Pilíře: ${queueItem.pillars.join(', ')}
Stav: ${queueItem.status}
Vytvořeno: ${new Date(queueItem.timestamp).toLocaleString()}

Tento úkol sleduje auditní proceduru JurisReview.`;
      
      await createJurisTask(driveToken, googleTasksListId, title, notes);
      setSuccessTaskMessage(`Úloha v_${queueItem.version || 'Draft'} byla vyexportována do Google Tasks.`);
      await fetchTasksFromGoogle(driveToken);
      setTimeout(() => setSuccessTaskMessage(null), 5000);
    } catch (e: any) {
      alert(`Nepodařilo se vyexportovat úkol: ${e.message}`);
    } finally {
      setIsCreatingTask(false);
    }
  };

  const completeGoogleTaskNow = async (taskId: string) => {
    if (!driveToken || !googleTasksListId) return;
    try {
      await completeJurisTask(driveToken, googleTasksListId, taskId);
      setSuccessTaskMessage('Úkol byl označen jako splněný v Google Tasks.');
      await fetchTasksFromGoogle(driveToken);
      setTimeout(() => setSuccessTaskMessage(null), 4000);
    } catch (e: any) {
      alert(`Nepodařilo se splnit úkol: ${e.message}`);
    }
  };

  const deleteGoogleTaskNow = async (taskId: string) => {
    if (!driveToken || !googleTasksListId) return;
    setConfirmDialog({
      title: 'SMAZÁNÍ ÚKOLU Z GOOGLE TASKS',
      message: 'Opravdu si přejete smazat tento úkol z Vašeho Google Tasks účtu?',
      onConfirm: async () => {
        try {
          await deleteJurisTask(driveToken, googleTasksListId, taskId);
          setSuccessTaskMessage('Úkol byl smazán z Google Tasks.');
          await fetchTasksFromGoogle(driveToken);
          setTimeout(() => setSuccessTaskMessage(null), 4500);
        } catch (e: any) {
          alert(`Nepodařilo se smazat úkol: ${e.message}`);
        }
      }
    });
  };

  const registerTaskFromGoogleToQueue = (task: GoogleTask) => {
    // DUPES CHECK: check if a task with the same title already exists in states pending or processing
    const hasDuplicate = auditQueue.some(t => 
      (t.status === 'pending' || t.status === 'processing') && 
      (t.title === task.title)
    );

    if (hasDuplicate) {
      alert(`Došlo k přeskočení importu. Úkol se stejným názvem "${task.title}" již v auditní frontě existuje (ve stavu pending nebo processing).`);
      return;
    }

    // Extract version suffix from task title like "AUDIT: F16" or "AUDIT: F18_re"
    let ver = 'EXT';
    const match = task.title.match(/AUDIT:\s*([^\s]+)/i) || task.title.match(/AUDIT\s+([^\s]+)/i);
    if (match) {
      ver = match[1];
    } else {
      ver = task.title.replace(/AUDIT:/i, '').trim().split(' ')[0] || 'V_EXT';
    }

    const matchingFiles = uploadedFiles.filter(f => f.caseId === currentCaseId && f.version === ver && f.category === 'MAIN');
    const fileNames = matchingFiles.length > 0 
      ? matchingFiles.map(f => f.name) 
      : uploadedFiles.filter(f => f.caseId === currentCaseId && f.category === 'MAIN').slice(0, 1).map(f => f.name);

    if (fileNames.length === 0) {
      fileNames.push("Externě vyžádaný soubor");
    }

    const newTask: AuditTask = {
      id: `G-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
      files: fileNames,
      supportFiles: [],
      pillars: [...selectedPillarIds],
      status: 'pending',
      timestamp: Date.now(),
      version: ver,
      title: task.title
    };

    setAuditQueue(prev => [...prev, newTask]);
    alert(`Externí požadavek '${task.title}' byl úspěšně zaregistrován do auditní fronty pod verzí '${ver}'.`);
  };

  const login = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setDriveToken(credential.accessToken);
        autoLocateLexFolder(credential.accessToken);
        fetchTasksFromGoogle(credential.accessToken);
      }
    } catch (e) {
      console.error('Login failed:', e);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setDriveToken(null);
      setGoogleTasksListId(null);
      setGoogleTasks([]);
      window.location.reload();
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  const autoLocateLexFolder = async (token: string) => {
    setIsFetchingDrive(true);
    try {
      const q = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and name = 'Google_LG13_Lex' and trashed = false");
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.files && data.files.length > 0) {
          const lexFolder = data.files[0];
          setCurrentDriveFolderId(lexFolder.id);
          setDriveFolderHistory([{ id: lexFolder.id, name: 'Google_LG13_Lex' }]);
          await fetchDriveFiles(lexFolder.id, token);
          // Trigger scan for version-specific folders (F****) like F18, F16 to auto-import and pre-index them
          scanAndAutoImportVersionFolders(lexFolder.id, token);
          return;
        }
      }
      // Fallback to root
      setCurrentDriveFolderId('root');
      setDriveFolderHistory([]);
      await fetchDriveFiles('root', token);
    } catch (err) {
      console.error('Auto locate lex folder error:', err);
      setCurrentDriveFolderId('root');
      setDriveFolderHistory([]);
      await fetchDriveFiles('root', token);
    } finally {
      setIsFetchingDrive(false);
    }
  };

  const scanAndAutoImportVersionFolders = async (parentFolderId: string, token: string) => {
    try {
      const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const folders = data.files || [];
      
      // Filter folders matching "F****" (starting with F followed by numbers/alpha, e.g. F18, F16, F16_4, F12)
      const fFolders = folders.filter((f: any) => {
        const name = f.name.toUpperCase();
        return /^F\d+|^F_\d+|^F[A-Z0-9_\-]+/.test(name) && name.length >= 2;
      });

      if (fFolders.length === 0) return;

      // Get existing versions currently in the workspace to avoid dupes
      const existingVersions = new Set(uploadedFiles.map(f => f.version));

      const toImport = fFolders.filter((folder: any) => {
        if (existingVersions.has(folder.name)) {
          console.log(`Verze ${folder.name} již v databázi existuje. Přeskakuji automatický import.`);
          return false;
        }
        return true;
      });

      if (toImport.length === 0) return;

      // Reset priority check variables when scanning a new batch
      setPriorityImportIds(new Set());
      setBackgroundImportStarted(false);

      // Open a beautiful prompt where user can select priority folders and leave other ones for the background
      setDriveFoldersToImportPrompt(toImport.map((folder: any) => ({
        id: folder.id,
        name: folder.name,
        selected: true
      })));

    } catch (err) {
      console.error('Chyba při prohledávání složek s verzemi F****:', err);
    }
  };

  const autoImportSingleVersionFolder = async (folderId: string, folderName: string, token: string) => {
    const activeId = `AI-${Math.random().toString(36).substr(2, 4)}`;
    setActiveAutoImports(prev => [...prev, { id: activeId, name: folderName, status: 'Zahajuji stahování...' }]);

    const newFiles: FileEntry[] = [];
    const batchId = `AUTO-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    try {
      const traverse = async (fId: string, currentVersionName: string) => {
        setActiveAutoImports(prev => prev.map(a => a.id === activeId ? { ...a, status: `Skenuji: ${currentVersionName || folderName}...` } : a));
        const q = encodeURIComponent(`'${fId}' in parents and trashed = false`);
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const items = data.files || [];

        // Načtení index cache z Disku pro tuto složku
        let folderIndexMap: Record<string, string> = {};
        const metadataItem = items.find((item: any) => item.name === '_index_metadata.json');
        if (metadataItem) {
          try {
            console.log(`Nalezena cache metadata indexace _index_metadata.json v Drive složce ${fId}`);
            const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${metadataItem.id}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (metaRes.ok) {
              const metaText = await metaRes.text();
              folderIndexMap = JSON.parse(metaText);
              console.log(`Úspěšně načtena cache indexů s ${Object.keys(folderIndexMap).length} záznamy.`);
            }
          } catch (e) {
            console.error('Chyba při stahování/parsování _index_metadata.json cache:', e);
          }
        }

        for (const item of items) {
          if (item.name === '_index_metadata.json') continue; // Preskocit indexacni cache soubor

          const isFolder = item.mimeType === 'application/vnd.google-apps.folder';
          if (isFolder) {
            const nextVersionName = currentVersionName || item.name;
            await traverse(item.id, nextVersionName);
          } else {
            setActiveAutoImports(prev => prev.map(a => a.id === activeId ? { ...a, status: `Stahuji z diskus... ${item.name}` } : a));
            let fileContent = '';
            let fileType = item.mimeType.split('.').pop()?.toUpperCase() || 'DRIVE';
            const itemVersion = currentVersionName || folderName;

            try {
              if (item.mimeType === 'application/vnd.google-apps.document') {
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}/export?mimeType=text/plain`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  fileContent = await downloadRes.text();
                  fileType = 'DOC';
                }
              } else if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}/export?mimeType=text/csv`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  fileContent = await downloadRes.text();
                  fileType = 'CSV';
                }
              } else if (item.mimeType === 'application/zip' || item.mimeType === 'application/x-zip-compressed' || item.name.toLowerCase().endsWith('.zip')) {
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}?alt=media`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  const zipBuffer = await downloadRes.arrayBuffer();
                  const zip = new JSZip();
                  const content = await zip.loadAsync(zipBuffer);
                  for (const [filePath, entry] of Object.entries(content.files)) {
                    if (!entry.dir) {
                      const fIdRef = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                      const fCont = await entry.async('string');
                      const savedZipItemInsight = folderIndexMap[entry.name] || folderIndexMap[filePath];
                      newFiles.push({
                        id: fIdRef,
                        name: entry.name,
                        type: filePath.split('.').pop()?.toUpperCase() || 'ZIP_ITEM',
                        isUploaded: true,
                        timestamp: Date.now(),
                        batchId,
                        category: (itemVersion.toLowerCase().includes('skil') || entry.name.toLowerCase().includes('skil') || filePath.toLowerCase().includes('skil') || folderName.toLowerCase().includes('skil')) ? 'SKILLS' : 'ATTACH',
                        version: itemVersion,
                        caseId: currentCaseId,
                        content: fCont,
                        indexStatus: savedZipItemInsight ? 'DONE' : 'IDLE',
                        insight: savedZipItemInsight || undefined,
                        driveFolderId: fId,
                        driveFileId: item.id
                      });
                    }
                  }
                }
                continue;
              } else {
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}?alt=media`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  if (item.mimeType.includes('text') || item.mimeType.includes('json') || item.mimeType.includes('xml') || item.name.endsWith('.txt') || item.name.endsWith('.json') || item.name.endsWith('.md')) {
                    fileContent = await downloadRes.text();
                    fileType = item.name.split('.').pop()?.toUpperCase() || 'TXT';
                  } else if (item.mimeType.includes('officedocument.wordprocessingml') || item.name.toLowerCase().endsWith('.docx')) {
                    try {
                      const docxBuffer = await downloadRes.arrayBuffer();
                      const zip = await JSZip.loadAsync(docxBuffer);
                      const docXmlFile = zip.file("word/document.xml");
                      if (docXmlFile) {
                        const xmlContent = await docXmlFile.async("text");
                        const wtRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
                        let match;
                        const textParts: string[] = [];
                        while ((match = wtRegex.exec(xmlContent)) !== null) {
                          textParts.push(match[1]);
                        }
                        fileContent = textParts.join(" ")
                          .replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>')
                          .replace(/&quot;/g, '"')
                          .replace(/&apos;/g, "'")
                          .trim();
                      } else {
                        fileContent = `[Prázdný nebo nesprávný DOCX soubor z Google Drive]`;
                      }
                    } catch (e: any) {
                      console.error("Docx zip read error on auto-imported file:", e);
                      fileContent = `[Chyba při čtení DOCX souboru z Google Drive: ${e?.message || String(e)}]`;
                    }
                    fileType = 'DOCX';
                  } else if (item.mimeType.includes('pdf')) {
                    fileContent = `[Stáhnutý binární PDF soubor: ${item.name}. Pro plnou analýzu doporučujeme Google Dokumenty nebo čistě textový formát.]`;
                    fileType = 'PDF';
                  } else {
                    fileContent = `[Stáhnutý binární soubor: ${item.mimeType}]`;
                    fileType = item.name.split('.').pop()?.toUpperCase() || 'BIN';
                  }
                }
              }

              const newFileId = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
              const savedInsight = folderIndexMap[item.name];
              newFiles.push({
                id: newFileId,
                name: item.name,
                type: fileType,
                isUploaded: true,
                timestamp: Date.now(),
                batchId,
                category: (itemVersion.toLowerCase().includes('skil') || item.name.toLowerCase().includes('skil') || folderName.toLowerCase().includes('skil')) ? 'SKILLS' : 'ATTACH',
                version: itemVersion,
                caseId: currentCaseId,
                content: fileContent,
                indexStatus: savedInsight ? 'DONE' : 'IDLE',
                insight: savedInsight || undefined,
                driveFolderId: fId,
                driveFileId: item.id
              });
            } catch (err) {
              console.error(`Chyba stahování souboru ${item.name} při auto-importu:`, err);
            }
          }
        }
      };

      await traverse(folderId, '');

      if (newFiles.length > 0) {
        setUploadedFiles(prev => [...prev, ...newFiles]);
        setActiveAutoImports(prev => prev.map(a => a.id === activeId ? { ...a, status: `Uloženo ${newFiles.length} dokumentů k pre-indexaci.` } : a));
        setTimeout(() => {
          setActiveAutoImports(prev => prev.filter(a => a.id !== activeId));
        }, 5000);
      } else {
        setActiveAutoImports(prev => prev.map(a => a.id === activeId ? { ...a, status: `Složka neobsahovala textové dokumenty.` } : a));
        setTimeout(() => {
          setActiveAutoImports(prev => prev.filter(a => a.id !== activeId));
        }, 3000);
      }
    } catch (err) {
      console.error(`Chyba automatického importu ${folderName}:`, err);
      setActiveAutoImports(prev => prev.filter(a => a.id !== activeId));
    }
  };

  const fetchDriveFiles = async (folderId: string, token: string) => {
    setIsFetchingDrive(true);
    setDriveError(null);
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`;
      
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Chyba při načítání obsahu');
      }
      const data = await res.json();
      
      // Client-side sort: folders first, then files
      const sorted = (data.files || []).sort((a: any, b: any) => {
        const isAFolder = a.mimeType === 'application/vnd.google-apps.folder';
        const isBFolder = b.mimeType === 'application/vnd.google-apps.folder';
        if (isAFolder && !isBFolder) return -1;
        if (!isAFolder && isBFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      
      setDriveFiles(sorted);
    } catch (err: any) {
      console.error('Fetch drive files error:', err);
      setDriveError(err?.message || 'Chyba při načítání souborů z Disku Google.');
    } finally {
      setIsFetchingDrive(false);
    }
  };

  const navigateToDriveFolder = (folderId: string, folderName: string) => {
    if (!driveToken) return;
    setDriveFolderHistory(prev => {
      if (prev.some(item => item.id === folderId)) {
        const index = prev.findIndex(item => item.id === folderId);
        return prev.slice(0, index + 1);
      }
      return [...prev, { id: folderId, name: folderName }];
    });
    setCurrentDriveFolderId(folderId);
    fetchDriveFiles(folderId, driveToken);
  };

  const navigateToBreadcrumb = (index: number) => {
    if (!driveToken) return;
    if (index === -1) {
      setCurrentDriveFolderId('root');
      setDriveFolderHistory([]);
      fetchDriveFiles('root', driveToken);
    } else {
      const target = driveFolderHistory[index];
      setDriveFolderHistory(prev => prev.slice(0, index + 1));
      setCurrentDriveFolderId(target.id);
      fetchDriveFiles(target.id, driveToken);
    }
  };

  const importDriveFile = async (fileId: string, name: string, mimeType: string, token: string, customVersionName?: string) => {
    setIsImportingFile(true);
    try {
      let fileContent = '';
      let fileType = mimeType.split('.').pop()?.toUpperCase() || 'DRIVE';
      const fileVersion = customVersionName || currentVersion;
      
      const isZip = mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed' || name.toLowerCase().endsWith('.zip');
      
      if (isZip) {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Nepodařilo se stáhnout ZIP soubor z Disku Google.');
        
        const zipBuffer = await res.arrayBuffer();
        const zip = new JSZip();
        const content = await zip.loadAsync(zipBuffer);
        const zipVersionName = name.replace('.zip', '').toUpperCase();
        
        const batchId = uploadBatchId || `B-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        const newFiles: FileEntry[] = [];
        
        for (const [filePath, entry] of Object.entries(content.files)) {
          if (!entry.dir) {
            const ext = filePath.split('.').pop()?.toLowerCase();
            const childFileId = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
            const childContent = await entry.async('string');
            
            newFiles.push({ 
              id: childFileId, 
              name: entry.name, 
              type: ext?.toUpperCase() || 'ZIP_ITEM', 
              isUploaded: true, 
              timestamp: Date.now(), 
              batchId,
              category: 'ATTACH', 
              version: customVersionName || zipVersionName, 
              caseId: currentCaseId,
              content: childContent,
              indexStatus: 'IDLE'
            });
          }
        }
        
        if (newFiles.length > 0) {
          setUploadedFiles(prev => [...prev, ...newFiles]);
          setShowDriveModal(false);
          alert(`Úspěšně rozbaleno a naimportováno ${newFiles.length} souborů ze ZIPu "${name}" z Disku Google k verzi "${customVersionName || zipVersionName}".`);
          return;
        } else {
          throw new Error('ZIP soubor na Disku Google je prázdný.');
        }
      }

      if (mimeType === 'application/vnd.google-apps.document') {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Nepodařilo se exportovat Google Dokument.');
        fileContent = await res.text();
        fileType = 'DOC';
      } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Nepodařilo se exportovat Google Tabulku.');
        fileContent = await res.text();
        fileType = 'CSV';
      } else {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Nepodařilo se stáhnout vybraný soubor.');
        
        if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('xml') || name.endsWith('.txt') || name.endsWith('.json') || name.endsWith('.md')) {
          fileContent = await res.text();
          fileType = name.split('.').pop()?.toUpperCase() || 'TXT';
        } else if (mimeType.includes('officedocument.wordprocessingml') || name.toLowerCase().endsWith('.docx')) {
          try {
            const docxBuffer = await res.arrayBuffer();
            const zip = await JSZip.loadAsync(docxBuffer);
            const docXmlFile = zip.file("word/document.xml");
            if (docXmlFile) {
              const xmlContent = await docXmlFile.async("text");
              const wtRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
              let match;
              const textParts: string[] = [];
              while ((match = wtRegex.exec(xmlContent)) !== null) {
                textParts.push(match[1]);
              }
              fileContent = textParts.join(" ")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .trim();
            } else {
              fileContent = `[Prázdný nebo nesprávný DOCX soubor z Google Drive]`;
            }
          } catch (e: any) {
            console.error("Docx zip read error on Drive file:", e);
            fileContent = `[Chyba při čtení DOCX souboru z Google Drive: ${e?.message || String(e)}]`;
          }
          fileType = 'DOCX';
        } else if (mimeType.includes('pdf')) {
          fileContent = `[Stáhnutý binární PDF soubor: ${name}. Pro plnou analýzu doporučujeme Google Dokumenty nebo čistě textový formát.]`;
          fileType = 'PDF';
        } else {
          fileContent = `[Stáhnutý binární soubor: ${mimeType}.]`;
          fileType = name.split('.').pop()?.toUpperCase() || 'BIN';
        }
      }

      const batchId = uploadBatchId || `B-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      const newFileId = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      
      const importedFile: FileEntry = {
        id: newFileId,
        name: name,
        type: fileType,
        isUploaded: true,
        timestamp: Date.now(),
        batchId,
        category: 'ATTACH',
        version: fileVersion,
        caseId: currentCaseId,
        content: fileContent,
        indexStatus: 'IDLE'
      };

      setUploadedFiles(prev => [...prev, importedFile]);
      setShowDriveModal(false);
      alert(`Úspěšně naimportován soubor "${name}" z Disku Google k verzi "${fileVersion}".`);
    } catch (err: any) {
      console.error('Import drive file error:', err);
      alert(`Nepodařilo se naimportovat soubor: ${err.message}`);
    } finally {
      setIsImportingFile(false);
    }
  };

  const importDriveFolderRecursively = async (folderId: string, folderName: string, token: string) => {
    setIsImportingFolder(true);
    setImportStatus(`Zahajuji rekurzivní stahování složky "${folderName}"...`);
    const newFiles: FileEntry[] = [];
    const batchId = uploadBatchId || `B-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

    try {
      const traverse = async (fId: string, currentVersionName: string) => {
        setImportStatus(`Prohledávám složku: ${currentVersionName || folderName}...`);
        
        const q = encodeURIComponent(`'${fId}' in parents and trashed = false`);
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Chyba při stahování seznamu u složky s ID ${fId}`);
        const data = await res.json();
        const items = data.files || [];

        for (const item of items) {
          const isFolder = item.mimeType === 'application/vnd.google-apps.folder';
          
          if (isFolder) {
            // Traverse into subfolder. Subfolders at the top specify major versions (e.g. F18, F16_4)
            const nextVersionName = currentVersionName || item.name;
            await traverse(item.id, nextVersionName);
          } else {
            setImportStatus(`Stahuji: ${item.name} (${currentVersionName || folderName})...`);
            
            let fileContent = '';
            let fileType = item.mimeType.split('.').pop()?.toUpperCase() || 'DRIVE';
            const itemVersion = currentVersionName || folderName;
            
            try {
              if (item.mimeType === 'application/vnd.google-apps.document') {
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}/export?mimeType=text/plain`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  fileContent = await downloadRes.text();
                  fileType = 'DOC';
                }
              } else if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}/export?mimeType=text/csv`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  fileContent = await downloadRes.text();
                  fileType = 'CSV';
                }
              } else if (item.mimeType === 'application/zip' || item.mimeType === 'application/x-zip-compressed' || item.name.toLowerCase().endsWith('.zip')) {
                // Inline unzip logic during folder retrieval
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}?alt=media`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  const zipBuffer = await downloadRes.arrayBuffer();
                  const zip = new JSZip();
                  const content = await zip.loadAsync(zipBuffer);
                  for (const [filePath, entry] of Object.entries(content.files)) {
                    if (!entry.dir) {
                      const fIdRef = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                      const fCont = await entry.async('string');
                      newFiles.push({
                        id: fIdRef,
                        name: entry.name,
                        type: filePath.split('.').pop()?.toUpperCase() || 'ZIP_ITEM',
                        isUploaded: true,
                        timestamp: Date.now(),
                        batchId,
                        category: (itemVersion.toLowerCase().includes('skil') || entry.name.toLowerCase().includes('skil') || filePath.toLowerCase().includes('skil') || folderName.toLowerCase().includes('skil')) ? 'SKILLS' : 'ATTACH',
                        version: itemVersion,
                        caseId: currentCaseId,
                        content: fCont,
                        indexStatus: 'IDLE'
                      });
                    }
                  }
                }
                continue;
              } else {
                const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}?alt=media`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (downloadRes.ok) {
                  if (item.mimeType.includes('text') || item.mimeType.includes('json') || item.mimeType.includes('xml') || item.name.endsWith('.txt') || item.name.endsWith('.json') || item.name.endsWith('.md')) {
                    fileContent = await downloadRes.text();
                    fileType = item.name.split('.').pop()?.toUpperCase() || 'TXT';
                  } else if (item.mimeType.includes('officedocument.wordprocessingml') || item.name.toLowerCase().endsWith('.docx')) {
                    try {
                      const docxBuffer = await downloadRes.arrayBuffer();
                      const zip = await JSZip.loadAsync(docxBuffer);
                      const docXmlFile = zip.file("word/document.xml");
                      if (docXmlFile) {
                        const xmlContent = await docXmlFile.async("text");
                        const wtRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
                        let match;
                        const textParts: string[] = [];
                        while ((match = wtRegex.exec(xmlContent)) !== null) {
                          textParts.push(match[1]);
                        }
                        fileContent = textParts.join(" ")
                          .replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>')
                          .replace(/&quot;/g, '"')
                          .replace(/&apos;/g, "'")
                          .trim();
                      } else {
                        fileContent = `[Prázdný nebo nesprávný DOCX soubor z Google Drive]`;
                      }
                    } catch (e: any) {
                      console.error("Docx zip read error on manually-imported file:", e);
                      fileContent = `[Chyba při čtení DOCX souboru z Google Drive: ${e?.message || String(e)}]`;
                    }
                    fileType = 'DOCX';
                  } else if (item.mimeType.includes('pdf')) {
                    fileContent = `[Stáhnutý binární PDF soubor: ${item.name}. Pro plnou analýzu doporučujeme Google Dokumenty nebo čistě textový formát.]`;
                    fileType = 'PDF';
                  } else {
                    fileContent = `[Stáhnutý binární soubor: ${item.mimeType}]`;
                    fileType = item.name.split('.').pop()?.toUpperCase() || 'BIN';
                  }
                }
              }

              const newFileId = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
              newFiles.push({
                id: newFileId,
                name: item.name,
                type: fileType,
                isUploaded: true,
                timestamp: Date.now(),
                batchId,
                category: (itemVersion.toLowerCase().includes('skil') || item.name.toLowerCase().includes('skil') || folderName.toLowerCase().includes('skil')) ? 'SKILLS' : 'ATTACH',
                version: itemVersion,
                caseId: currentCaseId,
                content: fileContent,
                indexStatus: 'IDLE'
              });

            } catch (err) {
              console.error(`Chyba stahování souboru ${item.name}:`, err);
            }
          }
        }
      };

      // Traverse starting with empty currentVersionName so top directory names match actual system versions
      await traverse(folderId, '');

      if (newFiles.length > 0) {
        setUploadedFiles(prev => [...prev, ...newFiles]);
        alert(`Úspěšně staženo a naimportováno ${newFiles.length} souborů ze složky "${folderName}" z Disku Google. Soubory byly přiřazeny k příslušným verzím podle podadresářů.`);
        setShowDriveModal(false);
      } else {
        alert(`Ve složce "${folderName}" nebyly nalezeny žádné vhodné textové dokumenty.`);
      }

    } catch (err: any) {
      console.error('Import drive folder recursive error:', err);
      alert(`Došlo k chybě při rekurzivním importu složky: ${err.message}`);
    } finally {
      setIsImportingFolder(false);
      setImportStatus(null);
    }
  };

  const handleUrlOrIdImport = async (urlOrId: string) => {
    if (!urlOrId) return;
    if (!driveToken) {
      alert('Nejprve se prosím přihlaste a udělte souhlas pro Disk Google.');
      return;
    }
    
    let fileId = urlOrId.trim();
    let isFolderUrl = false;
    
    // Parse Google Drive folder or file link
    if (urlOrId.includes('/folders/')) {
      isFolderUrl = true;
      const parts = urlOrId.split('/folders/');
      if (parts[1]) {
        fileId = parts[1].split('?')[0].split('/')[0];
      }
    } else if (urlOrId.includes('/d/')) {
      const parts = urlOrId.split('/d/');
      if (parts[1]) {
        fileId = parts[1].split('/')[0];
      }
    } else if (urlOrId.includes('id=')) {
      const parts = urlOrId.split('id=');
      if (parts[1]) {
        fileId = parts[1].split('&')[0];
      }
    }

    if (isFolderUrl) {
      setIsImportingFolder(true);
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name`, {
          headers: { Authorization: `Bearer ${driveToken}` }
        });
        if (!res.ok) throw new Error('Nepodařilo se načíst složku. Ověřte oprávnění.');
        const folderMeta = await res.json();
        await importDriveFolderRecursively(folderMeta.id, folderMeta.name, driveToken);
      } catch (e: any) {
        alert(`Chyba složky: ${e.message}`);
        setIsImportingFolder(false);
      }
    } else {
      setIsImportingFile(true);
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`, {
          headers: { Authorization: `Bearer ${driveToken}` }
        });
        if (!res.ok) {
          throw new Error('Nepodařilo se načíst soubor s tímto ID. Máte k němu přístup?');
        }
        const meta = await res.json();
        if (meta.mimeType === 'application/vnd.google-apps.folder') {
          await importDriveFolderRecursively(meta.id, meta.name, driveToken);
        } else {
          await importDriveFile(meta.id, meta.name, meta.mimeType, driveToken);
        }
      } catch (err: any) {
        alert(`Chyba: ${err.message}`);
      } finally {
        setIsImportingFile(false);
      }
    }
  };

  const createDriveFolder = async (name: string, parentFolderId?: string) => {
    if (!driveToken) return null;
    try {
      const metadata: any = {
        name,
        mimeType: 'application/vnd.google-apps.folder'
      };
      if (parentFolderId) {
        metadata.parents = [parentFolderId];
      }
      const res = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
      });
      if (!res.ok) {
        throw new Error('Chyba při vytváření složky na Disku Google');
      }
      return await res.json();
    } catch (err) {
      console.error('Create Folder error:', err);
      throw err;
    }
  };

  const uploadFileToDrive = async (name: string, content: string, mimeType: string, parentFolderId?: string) => {
    if (!driveToken) return null;
    try {
      const metadata: any = {
        name,
        mimeType
      };
      if (parentFolderId) {
        metadata.parents = [parentFolderId];
      }

      const boundary = '314159265358979323846264';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const multipartBody = 
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: ' + mimeType + '; charset=UTF-8\r\n\r\n' +
        content +
        closeDelim;

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error?.message || 'Chyba při nahrávání na Disk');
      }
      return await res.json();
    } catch (err) {
      console.error('Upload to Drive error:', err);
      throw err;
    }
  };

  const backgroundUploadToDrive = async (name: string, content: string, versionName: string) => {
    if (!driveToken) return;
    try {
      // Find or create version match folder
      const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${versionName}' and trashed = false`);
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`, {
        headers: { Authorization: `Bearer ${driveToken}` }
      });
      
      let targetFolderId: string | undefined = undefined;
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          targetFolderId = searchData.files[0].id;
        }
      }

      if (!targetFolderId) {
        const parentQ = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = 'Google_LG13_Lex' and trashed = false`);
        const parentSearchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${parentQ}&fields=files(id,name)&pageSize=1`, {
          headers: { Authorization: `Bearer ${driveToken}` }
        });
        
        let parentLexFolderId: string | undefined = undefined;
        if (parentSearchRes.ok) {
          const pData = await parentSearchRes.json();
          if (pData.files && pData.files.length > 0) {
            parentLexFolderId = pData.files[0].id;
          }
        }

        const createdFolder = await createDriveFolder(versionName, parentLexFolderId);
        if (createdFolder) {
          targetFolderId = createdFolder.id;
        }
      }

      await uploadFileToDrive(name, content, 'text/plain', targetFolderId);
    } catch (err) {
      console.error('backgroundUploadToDrive error:', err);
    }
  };

  const saveIndexToGoogleDrive = async (file: FileEntry, insight: string) => {
    if (!driveToken || !file.driveFolderId) return;
    try {
      const folderId = file.driveFolderId;
      const fileName = file.name;
      
      const q = encodeURIComponent(`'${folderId}' in parents and name = '_index_metadata.json' and trashed = false`);
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`, {
        headers: { Authorization: `Bearer ${driveToken}` }
      });
      
      if (!searchRes.ok) return;
      const searchData = await searchRes.json();
      const files = searchData.files || [];
      
      if (files.length > 0) {
        const indexFileId = files[0].id;
        
        const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`, {
          headers: { Authorization: `Bearer ${driveToken}` }
        });
        
        let currentMap: Record<string, string> = {};
        if (downloadRes.ok) {
          try {
            const text = await downloadRes.text();
            currentMap = JSON.parse(text);
          } catch(err) {
            console.error('Failed to parse existing _index_metadata.json:', err);
          }
        }
        
        currentMap[fileName] = insight;
        
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${indexFileId}?uploadType=media`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${driveToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(currentMap)
        });
        console.log(`Saved index_metadata.json update to Google Drive folder ${folderId}`);
      } else {
        const initialMap = { [fileName]: insight };
        await uploadFileToDrive('_index_metadata.json', JSON.stringify(initialMap), 'application/json', folderId);
        console.log(`Created index_metadata.json on Google Drive folder ${folderId}`);
      }
    } catch (err) {
      console.error('Error in saveIndexToGoogleDrive:', err);
    }
  };

  const uploadAnalysisToDriveForVersion = async (versionName: string, content: string) => {
    if (!driveToken) {
      alert('Nejprve se prosím přihlaste vpravo nahoře pro přístup k Disku Google.');
      return;
    }
    
    setIsSavingAnalysisToDrive(true);
    try {
      const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${versionName}' and trashed = false`);
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`, {
        headers: { Authorization: `Bearer ${driveToken}` }
      });
      
      let targetFolderId: string | undefined = undefined;
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          targetFolderId = searchData.files[0].id;
        }
      }

      if (!targetFolderId) {
        const parentQ = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = 'Google_LG13_Lex' and trashed = false`);
        const parentSearchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${parentQ}&fields=files(id,name)&pageSize=1`, {
          headers: { Authorization: `Bearer ${driveToken}` }
        });
        
        let parentLexFolderId: string | undefined = undefined;
        if (parentSearchRes.ok) {
          const pData = await parentSearchRes.json();
          if (pData.files && pData.files.length > 0) {
            parentLexFolderId = pData.files[0].id;
          }
        }

        const createdFolder = await createDriveFolder(versionName, parentLexFolderId);
        if (createdFolder) {
          targetFolderId = createdFolder.id;
        }
      }

      const dateStr = new Date().toLocaleDateString('cs-CZ').replace(/\s/g, '');
      const timeStr = new Date().toLocaleTimeString('cs-CZ').replace(/:/g, '-');
      const filename = `Analyza_${versionName}_${dateStr}_${timeStr}.md`;
      const result = await uploadFileToDrive(filename, content, 'text/markdown', targetFolderId);
      
      if (result) {
        alert(`Analýza byla úspěšně uložena na Disk Google do složky "${versionName}" jako "${filename}".`);
      }
    } catch (err: any) {
      console.error('Export analysis error:', err);
      alert(`Nepodařilo se uložit analýzu na Disk Google: ${err.message}`);
    } finally {
      setIsSavingAnalysisToDrive(false);
    }
  };

  // Test Connection
  useEffect(() => {
    if (user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
          setIsFirebaseOffline(false);
        } catch (error: any) {
          if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('offline') || error.message.includes('unreachable') || error.message.includes('unavailable'))) {
            console.error("Please check your Firebase configuration.");
            setIsFirebaseOffline(true);
          }
        }
      };
      testConnection();
    }
  }, [user]);

  // Cloud Sync Logic
  useEffect(() => {
    if (!user) return;

    const loadFromCloud = async () => {
      const uid = user.uid;
      try {
        const filesSnap = await getDocs(collection(db, `users/${uid}/files`));
        const queueSnap = await getDocs(collection(db, `users/${uid}/queue`));
        const historySnap = await getDocs(collection(db, `users/${uid}/history`));
        const casesSnap = await getDocs(collection(db, `users/${uid}/cases`));
        const settingsSnap = await getDoc(doc(db, `users/${uid}/settings`, 'current'));

        if (!filesSnap.empty) {
          const cloudFiles = filesSnap.docs.map(d => d.data() as FileEntry);
          setUploadedFiles(prev => {
            const merged = [...cloudFiles];
            prev.forEach(localFile => {
              const cloudIndex = merged.findIndex(f => f.id === localFile.id);
              if (cloudIndex === -1) {
                merged.push(localFile);
              } else if ((localFile.timestamp || 0) > (merged[cloudIndex].timestamp || 0)) {
                merged[cloudIndex] = localFile;
              }
            });
            return merged;
          });
        }
        if (!queueSnap.empty) {
          const cloudQueue = queueSnap.docs.map(d => d.data() as AuditTask);
          setAuditQueue(prev => {
            const merged = [...cloudQueue];
            prev.forEach(localTask => {
              const cloudIndex = merged.findIndex(t => t.id === localTask.id);
              if (cloudIndex === -1) {
                merged.push(localTask);
              } else if ((localTask.timestamp || 0) > (merged[cloudIndex].timestamp || 0)) {
                merged[cloudIndex] = localTask;
              }
            });
            return merged;
          });
        }
        if (!historySnap.empty) {
          const cloudHistory = historySnap.docs.map(d => d.data() as VersionRecord);
          setHistory(prev => {
            const merged = [...cloudHistory];
            prev.forEach(localHistory => {
              const cloudIndex = merged.findIndex(h => h.id === localHistory.id);
              if (cloudIndex === -1) {
                merged.push(localHistory);
              } else if ((localHistory.timestamp || 0) > (merged[cloudIndex].timestamp || 0)) {
                merged[cloudIndex] = localHistory;
              }
            });
            return merged;
          });
        }
        if (!casesSnap.empty) {
          const cloudCases = casesSnap.docs.map(d => d.data() as CaseRecord);
          setCases(prev => {
            const merged = [...cloudCases];
            prev.forEach(localCase => {
              const cloudIndex = merged.findIndex(c => c.id === localCase.id);
              if (cloudIndex === -1) {
                merged.push(localCase);
              }
            });
            return merged;
          });
        }
        
        if (settingsSnap.exists()) {
          const s = settingsSnap.data();
          if (s.currentCaseId) setCurrentCaseId(s.currentCaseId);
          if (s.currentVersion) setCurrentVersion(s.currentVersion);
          if (s.queueStrategy) setQueueStrategy(s.queueStrategy);
          if (s.gitContext) setGitContext(s.gitContext);
        }
        setIsFirebaseOffline(false);
      } catch (err: any) {
        if (err && (err.message?.includes('offline') || err.message?.includes('Failed to get document because the client is offline') || err.code === 'unavailable')) {
          setIsFirebaseOffline(true);
        }
        if (err && (err.message?.includes('Quota limit exceeded') || err.message?.includes('quota') || err.code === 'resource-exhausted')) {
          setIsFirebaseQuotaExceeded(true);
        }
        handleFirestoreError(err, OperationType.GET, 'initial_load');
      }
    };

    loadFromCloud();
  }, [user]);

  const syncToCloud = async (key: string, data: any) => {
    if (!user || !isLoaded.current || isResetting.current) return;
    if (isFirebaseQuotaExceeded) {
      console.warn(`Cloud synchronization for ${key} is paused due to exceeded Firestore Free Tier Quota limits.`);
      return;
    }
    setIsCloudSyncing(true);
    const uid = user.uid;
    
    // Safely strips any undefined fields and assigns userId
    const cleanEntity = (item: any) => {
      const cleaned = JSON.parse(JSON.stringify(item));
      cleaned.userId = uid;
      return cleaned;
    };

    try {
      if (key === 'juris_files') {
        const batch = writeBatch(db);
        data.forEach((f: FileEntry) => {
          batch.set(doc(db, `users/${uid}/files`, f.id), cleanEntity(f));
        });
        await batch.commit();
      } else if (key === 'juris_queue') {
        const batch = writeBatch(db);
        data.forEach((t: AuditTask) => {
          batch.set(doc(db, `users/${uid}/queue`, t.id), cleanEntity(t));
        });
        await batch.commit();
      } else if (key === 'juris_history') {
        const batch = writeBatch(db);
        data.forEach((h: VersionRecord) => {
          batch.set(doc(db, `users/${uid}/history`, h.id), cleanEntity(h));
        });
        await batch.commit();
      } else if (key === 'juris_cases') {
        const batch = writeBatch(db);
        data.forEach((c: CaseRecord) => {
          batch.set(doc(db, `users/${uid}/cases`, c.id), cleanEntity(c));
        });
        await batch.commit();
      } else {
        await setDoc(doc(db, `users/${uid}/settings`, 'current'), cleanEntity({
          currentCaseId,
          currentVersion,
          queueStrategy,
          gitContext,
        }));
      }
      setIsFirebaseOffline(false);
      setIsFirebaseQuotaExceeded(false);
    } catch (err: any) {
      if (err && (err.message?.includes('offline') || err.message?.includes('Failed to get document because the client is offline') || err.code === 'unavailable')) {
        setIsFirebaseOffline(true);
      }
      if (err && (err.message?.includes('Quota limit exceeded') || err.message?.includes('quota') || err.code === 'resource-exhausted' || err.message?.includes('exhausted'))) {
        setIsFirebaseQuotaExceeded(true);
      }
      handleFirestoreError(err, OperationType.WRITE, key);
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const toggleSelectionMode = (mode: 'FILES' | 'VERSIONS') => {
    setSelectionMode(mode);
    setCompareVersionIds([]);
    setReviewResult(null);
  };
  
  // Auto-Archive Logic: Files older than 24h
  useEffect(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    setUploadedFiles(prev => prev.map(f => {
      if (!f.isArchived && (now - f.timestamp > oneDay)) {
        return { ...f, isArchived: true };
      }
      return f;
    }));
  }, []);
  
  // Case hierarchy
  const [cases, setCases] = useState<CaseRecord[]>([
    { id: 'C01', name: 'Hlavní Spis', nr: '2026/LG/13', activeVersion: 'V3.0.0' },
    { id: 'C_INBOUND', name: 'PŘÍCHOZÍ DOKUMENTY', nr: 'PENDING_UPLOAD', activeVersion: 'NEW' }
  ]);
  const [currentCaseId, setCurrentCaseId] = useState('C01');
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);

  // Persistence logic (Load once on mount)
  useEffect(() => {
    try {
      const savedFiles = localStorage.getItem('juris_files');
      const savedQueue = localStorage.getItem('juris_queue');
      const savedStrategy = localStorage.getItem('juris_strategy');
      const savedHistory = localStorage.getItem('juris_history');
      const savedCases = localStorage.getItem('juris_cases');
      const savedCaseId = localStorage.getItem('juris_current_case_id');
      const savedVersion = localStorage.getItem('juris_version');
      const savedGit = localStorage.getItem('juris_git_context');

      if (savedFiles) setUploadedFiles(JSON.parse(savedFiles));
      if (savedQueue) setAuditQueue(JSON.parse(savedQueue));
      if (savedStrategy) setQueueStrategy(savedStrategy as any);
      if (savedHistory) setHistory(JSON.parse(savedHistory));
      if (savedCases) setCases(JSON.parse(savedCases));
      if (savedCaseId) setCurrentCaseId(savedCaseId);
      if (savedVersion) setCurrentVersion(savedVersion);
      if (savedGit) setGitContext(savedGit);
      
      // Mark as loaded after state updates are scheduled
      setTimeout(() => {
        isLoaded.current = true;
      }, 0);
    } catch (e) {
      console.error('Failed to restore session:', e);
      isLoaded.current = true; // Still mark as loaded to allow saving new data
    }
  }, []);

  const [storageError, setStorageError] = useState<string | null>(null);

  // Save changes to localStorage with size handling
  const safeSave = (key: string, value: string) => {
    if (!isLoaded.current || isResetting.current) return;
    try {
      localStorage.setItem(key, value);
      if (storageError && !user) setStorageError(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        console.warn(`Storage full for ${key}. Attempting lightweight fallback...`);
        
        if (key === 'juris_files') {
          try {
            const files = JSON.parse(value);
            if (Array.isArray(files)) {
              const lightweightFiles = files.map(f => ({
                ...f,
                content: f.content && f.content.length > 5000 ? f.content.substring(0, 5000) + '\n...[Zkráceno na 5KB z důvodu limitu prohlížeče. Pro plné ukládání se přihlaste]...' : f.content,
                insight: f.insight && f.insight.length > 2000 ? f.insight.substring(0, 2000) + '\n...[Zkráceno pro místní paměť]...' : f.insight
              }));
              localStorage.setItem(key, JSON.stringify(lightweightFiles));
              if (!user) {
                setStorageError(`MÍSTNÍ PAMĚŤ PROHLÍŽEČE JE PLNÁ: Vaše soubory byly v místní paměti uloženy v odlehčené verzi (zkrácený text). Přihlaste se prosím přes Google vpravo nahoře, abyste aktivoval cloudové úložiště pro neomezenou kapacitu a plný text.`);
              }
              return;
            }
          } catch (err) {
            console.error('Lightweight files backup error:', err);
          }
        }
        
        if (key === 'juris_history') {
          try {
            const historySnapshots = JSON.parse(value);
            if (Array.isArray(historySnapshots)) {
              const lightweightHistory = historySnapshots.map(h => ({
                ...h,
                text: h.text && h.text.length > 5000 ? h.text.substring(0, 5000) + '\n...[Zkráceno pro místní paměť]...' : h.text
              }));
              localStorage.setItem(key, JSON.stringify(lightweightHistory));
              return;
            }
          } catch (err) {
            console.error('Lightweight history backup error:', err);
          }
        }

        if (!user) {
          setStorageError(`VYČERPÁNA KAPACITA PAMĚTI (${key}): Data nelze uložit lokálně. Doporučujeme se přihlásit (vpravo nahoře) pro neomezené cloudové úložiště.`);
        }
      }
    }
  };

  useEffect(() => { 
    safeSave('juris_files', JSON.stringify(uploadedFiles)); 
    if (user) syncToCloud('juris_files', uploadedFiles);
  }, [uploadedFiles]);
  
  useEffect(() => { 
    safeSave('juris_queue', JSON.stringify(auditQueue)); 
    if (user) syncToCloud('juris_queue', auditQueue);
  }, [auditQueue]);
  
  useEffect(() => { 
    safeSave('juris_strategy', queueStrategy); 
    if (user) syncToCloud('juris_strategy', queueStrategy);
  }, [queueStrategy]);
  
  useEffect(() => { 
    safeSave('juris_history', JSON.stringify(history)); 
    if (user) syncToCloud('juris_history', history);
  }, [history]);
  
  useEffect(() => { 
    safeSave('juris_cases', JSON.stringify(cases)); 
    if (user) syncToCloud('juris_cases', cases);
  }, [cases]);
  
  useEffect(() => { 
    safeSave('juris_current_case_id', currentCaseId); 
    if (user) syncToCloud('juris_current_case_id', currentCaseId);
  }, [currentCaseId]);
  
  useEffect(() => { 
    safeSave('juris_version', currentVersion); 
    if (user) syncToCloud('juris_version', currentVersion);
  }, [currentVersion]);
  
  useEffect(() => { 
    safeSave('juris_git_context', gitContext); 
    if (user) syncToCloud('juris_git_context', gitContext);
  }, [gitContext]);

  // Sync state to current snapshot in cases list
  useEffect(() => {
    if (currentCaseId && currentVersion) {
      setCases(prev => {
        const needsUpdate = prev.some(c => c.id === currentCaseId && c.activeVersion !== currentVersion);
        if (!needsUpdate) return prev;
        return prev.map(c => c.id === currentCaseId ? { ...c, activeVersion: currentVersion } : c);
      });
    }
  }, [currentVersion, currentCaseId]);
  
  const TECHNICAL_README = `# §LG13§ TECHNICAL ARCHITECTURE MANIFESTO v4.0
## Forenzní Právní Engine
Tento systém je navržen pro precizní audit a kompozici právních podání.

### Core Moduly:
1. **Atomic Parser**: Rozkládá dokumenty na argumentační atomy (Fakt-Právo-Důkaz).
2. **Relational Mapper**: Sleduje hierarchii Spis -> Verze -> Dokumenty.
3. **Cross-Reference Engine**: Verifikuje existenci příloh (P1, P2...) v reálném čase.

### Správa Souborů a Verzí:
- **Automatické přiřazení**: Soubory nahrané během aktivního spisu/verze jsou k nim automaticky připojeny.
- **Sirotčí soubory (ORPHAN)**: Pokud nahrajete soubory mimo kontext, použijte filtr "OSIŘELÉ SOUBORY".
- **Hromadné přiřazení**: Označte soubory a použijte "PŘIŘADIT K AKTUÁLNÍMU" v horní liště.
- **ZIP Upload**: Podporuje hromadné nahrávání uvnitř archivu.

### API & Integrace:
- **GitHub Sync (Concept)**: Protokol pro automatické nasazování verifikovaných draftů.
- **TLS 1.3 Encryption**: Veškerý přenos dat je šifrován na úrovni bankovních standardů.

### Právní Rámec:
Optimalizováno pro NOZ 2026, ZŘS po novelách 2025/2026.
`;

  const downloadTechnicalReadme = () => {
    const blob = new Blob([TECHNICAL_README], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'LG13_TECHNICAL_GUIDE.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const toggleSelectAll = () => {
    // Check if all currently filtered files are already selected
    const allFilteredSelected = filteredFiles.length > 0 && 
                                filteredFiles.every(f => selectedBulkIds.includes(f.id));
    
    if (allFilteredSelected) {
      // If all are selected, remove only the filtered ones from selection
      const filteredIds = filteredFiles.map(f => f.id);
      setSelectedBulkIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      // Otherwise, add all filtered files to selection (while keeping others)
      const newIds = filteredFiles.map(f => f.id).filter(id => !selectedBulkIds.includes(id));
      setSelectedBulkIds(prev => [...prev, ...newIds]);
    }
  };

  // Dynamic metrics for footer
  const [dynamicScore, setDynamicScore] = useState(98.2);
  const [dynamicRisk, setDynamicRisk] = useState('LEVEL_1');

  const resultRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Removed shadowed persistence logic

  const downloadReport = (taskId: string) => {
    const task = auditQueue.find(t => t.id === taskId);
    if (!task || !task.result) return;
    
    const blob = new Blob([task.result], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `AUDIT_${task.version || ''}_${task.id}.md`);
  };

  const downloadAllResults = async (onlyToday = false, format: 'ZIP' | 'PDF' = 'ZIP') => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const tasksToExport = auditQueue.filter(t => {
      const isDone = t.status === 'done' && t.result;
      if (!isDone) return false;
      if (onlyToday) return t.timestamp >= startOfToday.getTime();
      return true;
    });

    if (tasksToExport.length === 0) {
      alert(onlyToday ? 'DNES NEBYLY DOKONČENY ŽÁDNÉ ÚLOHY.' : 'ŽÁDNÉ DOKONČENÉ ÚLOHY KE STAŽENÍ.');
      return;
    }

    if (format === 'PDF') {
      try {
        // Beautiful Markdown-to-HTML formatter matching original system design
        const formatMDToHTML = (md: string) => {
          let html = md;
          // Clean triple-backtick lines and wrap in codeblocks
          html = html.replace(/```([\s\S]*?)```/g, '<pre style="background: rgba(0,0,0,0.5); border: 1px solid #332111; padding: 12px; font-family: monospace; font-size: 8px; margin: 10px 0; color: #C5A059; overflow-x: auto; white-space: pre-wrap; word-break: break-all;">$1</pre>');
          // Bold matches
          html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #ffffff; font-weight: 800;">$1</strong>');
          // Headings formatting
          html = html.replace(/^# (.*?)$/gm, '<h3 style="color: #C5A059; font-size: 11px; font-weight: 900; letter-spacing: 1px; border-bottom: 1px solid rgba(197, 160, 89, 0.2); padding-bottom: 4px; margin: 20px 0 10px 0; text-transform: uppercase;">$1</h3>');
          html = html.replace(/^## (.*?)$/gm, '<h4 style="color: #C5A059; font-size: 9px; font-weight: 900; letter-spacing: 0.5px; margin: 16px 0 8px 0; text-transform: uppercase;">$1</h4>');
          html = html.replace(/^### (.*?)$/gm, '<h5 style="color: #ffffff; font-size: 8px; font-weight: 800; margin: 12px 0 6px 0; text-transform: uppercase;">• $1</h5>');
          // Lists formatting
          html = html.replace(/^[*-] (.*?)$/gm, '<div style="padding-left: 10px; margin: 3px 0; font-size: 8px; color: rgba(255,255,255,0.8); text-transform: uppercase;"><span style="color: #C5A059; margin-right: 5px;">▪</span> $1</div>');
          // Paragraph formatting
          html = html.replace(/^(?!<h|<div|<pre)(.*?)$/gm, (match) => {
            if (!match.trim()) return '';
            return `<p style="font-size: 8.5px; color: rgba(255,255,255,0.75); margin: 0 0 8px 0; text-transform: uppercase; line-height: 1.5; letter-spacing: 0.2px;">${match}</p>`;
          });
          return html;
        };

        // Create elegant offscreen PDF render target
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-10000px';
        container.style.top = '0px';
        container.style.width = '750px';
        container.style.boxSizing = 'border-box';
        container.style.background = '#0d0d0d'; // Deep Slate Black background
        container.style.color = '#e2e8f0';
        container.style.padding = '45px';
        container.style.fontFamily = 'monospace, Courier New, sans-serif';

        let reportHtml = `
          <div style="border: 1px solid rgba(197,160,89,0.35); padding: 25px; margin-bottom: 35px; background: #060606; text-transform: uppercase;">
            <h1 style="color: #C5A059; margin: 0 0 10px 0; font-size: 16px; font-weight: 900; letter-spacing: 2px; border-bottom: 1px solid rgba(197, 160, 89, 0.25); padding-bottom: 12px;">
              §LG13§ JURIS-AUDIT SPECIÁLNÍ FORENZNÍ AUTOMONTÁŽ REPOR_PDF
            </h1>
            <div style="font-size: 8.5px; line-height: 1.6; color: rgba(255,255,255,0.65);">
              <div><strong>VYDAVATEL:</strong> JURIS-AUDIT INTEGRÁTOR</div>
              <div><strong>ČAS VYSTAVENÍ:</strong> ${new Date().toLocaleString('cs-CZ')}</div>
              <div><strong>EXPORT-KAPACITA:</strong> ${tasksToExport.length} ANALÝZ</div>
              <div><strong>STUPEŇ UTAJENÍ:</strong> VĚTĚBNÍ DŮVĚRNÉ INTERNÍ REJSTŘÍK</div>
            </div>
          </div>
        `;

        tasksToExport.forEach((task) => {
          const formattedRes = formatMDToHTML(task.result || '');
          reportHtml += `
            <div style="margin-bottom: 40px; border-bottom: 1px solid #1a1a1a; padding-bottom: 25px;">
              <div style="border-left: 2.5px solid #C5A059; padding-left: 12px; margin-bottom: 20px;">
                <span style="color: #C5A059; font-size: 7.5px; font-weight: 900; tracking: 1.5px; text-transform: uppercase;">AUDIT EVIDENCE ID: ${task.id}</span>
                <h2 style="color: #ffffff; font-size: 11px; font-weight: 900; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 0.5px;">
                  VERZE SPISU: ${task.version || 'Draft'} / ARCHIV REGISTER ELEMENT
                </h2>
              </div>
              <div style="background: #080808; border: 1px solid #151515; padding: 20px; font-size: 8px;">
                ${formattedRes}
              </div>
            </div>
          `;
        });

        // Verification validation terminal footer
        reportHtml += `
          <div style="border: 1px solid rgba(255,255,255,0.08); padding: 20px; background: #060606; text-align: center; margin-top: 40px; text-transform: uppercase;">
            <p style="color: #C5A059; margin: 0 0 3px 0; font-size: 9px; font-weight: 900; letter-spacing: 1px;">§ FORENZNÍ BEZPEČNOSTNÍ PROTOKOL §</p>
            <p style="font-size: 7.5px; color: #444; margin: 0 0 15px 0;">Ověřeno kryptografickým doložením pro systém LG13-2026</p>
            <div style="display: flex; justify-content: space-around; font-size: 8px; color: #666; margin-top: 15px;">
              <div>______________________<br/><span style="font-size: 7px; color: #333; margin-top: 4px; display:inline-block;">PODPIS ANALYTIKA</span></div>
              <div>______________________<br/><span style="font-size: 7px; color: #333; margin-top: 4px; display:inline-block;">ZESÍLENÝ PEČEŤ SYSTEMA</span></div>
            </div>
          </div>
        `;

        container.innerHTML = reportHtml;
        document.body.appendChild(container);

        // Capture with html2canvas and build PDF
        const canvas = await html2canvas(container, {
          backgroundColor: '#0d0d0d',
          scale: 1.5,
          useCORS: true,
          logging: false
        });
        document.body.removeChild(container);

        const imgWidth = 210; // A4 width in mm
        const pageHeight = 295; // A4 height in mm
        const canvasHeightInMM = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = canvasHeightInMM;
        let position = 0;

        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const pdf = new jsPDF('p', 'mm', 'a4');

        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, canvasHeightInMM);
        heightLeft -= pageHeight;

        while (heightLeft >= 0) {
          position = heightLeft - canvasHeightInMM;
          pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, canvasHeightInMM);
          heightLeft -= pageHeight;
        }

        pdf.save(onlyToday ? `AUDIT_REPORT_TODAY_${new Date().toISOString().split('T')[0]}.pdf` : `AUDIT_REPORT_ALL.pdf`);
      } catch (err) {
        console.error('PDF Generation Error:', err);
        alert('Chyba při sestavování PDF reportu přes html2canvas & jspdf.');
      }
    } else {
      // Standard ZIP code
      try {
        const zip = new JSZip();
        tasksToExport.forEach(task => {
          const fileName = `AUDIT_${task.version || ''}_${task.id}.md`;
          zip.file(fileName, task.result!);
        });

        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, onlyToday ? `AUDIT_TODAY_${new Date().toISOString().split('T')[0]}.zip` : `AUDIT_EXPORT_ALL.zip`);
      } catch (e) {
        console.error('ZIP Error:', e);
        alert('Chyba při vytváření ZIP archivu.');
      }
    }
  };

  const printReport = () => {
    window.print();
  };

  const auditPillars = [
    { id: 'P01', name: 'Kontrola markerů', desc: 'Vyhledávání TBD/TODO značek', icon: <Eye size={12}/> },
    { id: 'P02', name: 'Relační synchronizace', desc: 'Soulad identifikace a rolí', icon: <RotateCcw size={12}/> },
    { id: 'P03', name: 'Detekce paradoxů', desc: 'Analýza časových a logických Update-Gaps', icon: <AlertCircle size={12}/> },
    { id: 'P04', name: 'Audit asymetrie', desc: 'Symetrie zkoumání obou stran', icon: <Scale size={12}/> },
    { id: 'P05', name: 'Cirkulární argumentace', desc: 'Detekce argumentačních smyček', icon: <RotateCcw size={12}/> },
    { id: 'P06', name: 'Heuristická integrita', desc: 'Validace citací (NOZ / ZŘS 2026)', icon: <ShieldCheck size={12}/> },
    { id: 'P07', name: 'Atomární audit', desc: 'Provázání Fakt -> Právo -> Důkaz', icon: <Layers size={12}/> },
    { id: 'P08', name: 'Red Team Report', desc: 'Zátěžový test integrity identity', icon: <ShieldCheck size={12}/> },
    { id: 'P09', name: 'Hierarchie 2+4', desc: 'Kontrola 2 hlavních a 4 sub argumentů', icon: <ListFilter size={12}/> },
    { id: 'P10', name: 'Nutriční Dieta', desc: 'Zeštíhlení a eliminace balastu', icon: <Scissors size={12}/> },
    { id: 'P11', name: 'Risk & Compliance', desc: 'Pravděpodobnost úspěchu a rizika', icon: <Gauge size={12}/> },
    { id: 'P12', name: 'Diferenční Analýza', desc: 'Integrace nových atomů z verzí', icon: <Diff size={12}/> },
    { id: 'P13', name: 'Administrativní Audit', desc: 'Kontrola procesních náležitostí', icon: <Scale size={12}/> },
    { id: 'P14', name: 'Audit Příloh', desc: 'Křížová kontrola existence příloh', icon: <Paperclip size={12}/> },
  ];

  const isIndexingRef = useRef(false);

  // Background Indexing Logic (Throttled & Locked)
  useEffect(() => {
    // Only start if not already indexing, not performing main review, auto-indexing is enabled, and no current quota cooldown is active
    if (isIndexingRef.current || isReviewing || !isAutoIndexingEnabled || quotaCountdown > 0) return;

    const idleFile = [...uploadedFiles]
      .filter(f => f.caseId === currentCaseId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .find(f => f.indexStatus === 'IDLE' && f.content && !f.isArchived);
    
    if (idleFile) {
      const processFile = async () => {
        isIndexingRef.current = true;
        
        const isBinaryPlaceholder = 
          idleFile.content?.startsWith('[Stáhnutý binární') || 
          idleFile.content?.startsWith('[Nahraný binární') || 
          idleFile.content?.startsWith('[Chyba parsování') || 
          idleFile.content?.startsWith('[Prázdný') ||
          !idleFile.content ||
          ['PDF', 'ZIP', 'BIN', 'PNG', 'JPG', 'JPEG', 'GIF'].includes(idleFile.type || '');

        if (isBinaryPlaceholder) {
          const defaultInsight = `Binární soubor (${idleFile.type || 'PDF'}) – pro plnou forenzní analýzu doporučujeme formát v čistém textu nebo dokument Google.`;
          setUploadedFiles(prev => prev.map(f => f.id === idleFile.id ? { ...f, indexStatus: 'DONE', insight: defaultInsight } : f));
          isIndexingRef.current = false;
          return;
        }

        // Brief delay to allow UI to breathe and avoid rapid-fire API hits
        await new Promise(resolve => setTimeout(resolve, 2000));

        setUploadedFiles(prev => prev.map(f => f.id === idleFile.id ? { ...f, indexStatus: 'INDEXING' } : f));
        
        try {
          // Minimalist context for indexing to save tokens and avoid overhead
          const prompt = `Získej stručný vhled (2 věty) pro dokument: ${idleFile.name}. Zaměř se na právní podstatu.`;
          
          const result = await reviewCourtRequest(prompt, [`FILE: ${idleFile.name}\nCONTENT:\n${idleFile.content?.substring(0, 10000)}`], ['INDEXACE'], [], '', 'AUDIT');
          const finalInsight = result || '';
          setUploadedFiles(prev => prev.map(f => f.id === idleFile.id ? { ...f, indexStatus: 'DONE', insight: finalInsight } : f));
          
          if (driveToken && idleFile.driveFolderId) {
            saveIndexToGoogleDrive(idleFile, finalInsight);
          }
        } catch (e: any) {
          console.error('Indexing failed for:', idleFile.name, e);
          const errorMsg = (e.message || '').toLowerCase();
          const isQuota = errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('resource_exhausted') || errorMsg.includes('exhausted') || errorMsg.includes('limit');
          if (isQuota) {
            setIsAutoIndexingEnabled(false);
            setQuotaCountdown(45);
            setError("⚠️ PRE-INDEXACE DOČASNĚ POZASTAVENA: Byl překročen bezplatný limit (Quota 429) pro Gemini API. Systém automaticky obnoví indexování aktivního spisu na pozadí za 45 sekund.");
          }
          setUploadedFiles(prev => prev.map(f => f.id === idleFile.id ? { ...f, indexStatus: 'ERROR' } : f));
          // Wait longer on error before next attempt
          await new Promise(resolve => setTimeout(resolve, 5000));
        } finally {
          isIndexingRef.current = false;
        }
      };
      processFile();
    }
  }, [uploadedFiles, isReviewing, isAutoIndexingEnabled, currentCaseId, quotaCountdown]);

  // Trigger background loading of non-priority folders when priority folders are done and indexed
  useEffect(() => {
    if (backgroundImportQueue.length === 0 || backgroundImportStarted || !driveToken) return;

    // Check if any priority folders are still running in background
    const activePriorityFolderNames = activeAutoImports.filter(a => priorityImportIds.has(a.name));
    if (activePriorityFolderNames.length > 0) return;

    // Check if any documents belonging to priority versions are still pending/indexing
    const indexingPriorityFiles = uploadedFiles.filter(f => 
      f.caseId === currentCaseId && 
      priorityImportIds.has(f.version || '') && 
      (f.indexStatus === 'IDLE' || f.indexStatus === 'INDEXING')
    );
    if (indexingPriorityFiles.length > 0) return;

    // Everything priority is ready and indexed! Start background imports
    console.log("Priority folders downloaded and indexed. Starting background imports...");
    setBackgroundImportStarted(true);
    backgroundImportQueue.forEach((folder) => {
      autoImportSingleVersionFolder(folder.id, folder.name, driveToken);
    });
    setBackgroundImportQueue([]);
  }, [uploadedFiles, activeAutoImports, backgroundImportQueue, priorityImportIds, backgroundImportStarted, currentCaseId, driveToken]);

  const allFiles = [...uploadedFiles];

  const sortFilesOrdered = (files: FileEntry[]) => {
    const order = [
      "0 Framing",
      "1 Přehled",
      "2 PO",
      "3 Karta PO",
      "4 PR",
      "5 Karta PR",
      "6 Vyjádření k PR ZZ",
      "7 Vyjádření k soudnímu přípisu",
      "8 doplnění č1 do 909",
      "9 Karta 3",
      "10 Karta 4",
      "11 Přehled příloh",
      "index",
      "soubory zip",
      "rejstřík"
    ];

    return [...files].sort((a, b) => {
      const getPriority = (name: string) => {
        const lowerName = name.toLowerCase();
        for (let i = 0; i < order.length; i++) {
          if (lowerName.includes(order[i].toLowerCase())) return i;
          // Exact prefix check like "0", "1", "2" at start
          const prefix = order[i].split(' ')[0];
          if (lowerName.startsWith(prefix.toLowerCase() + ' ')) return i;
        }
        // Handle P1, P2 references at end
        const pMatch = lowerName.match(/^p(\d+)/);
        if (pMatch) return 1000 + parseInt(pMatch[1]);
        return 2000;
      };

      const prioA = getPriority(a.name);
      const prioB = getPriority(b.name);
      
      if (prioA !== prioB) return prioA - prioB;
      return a.name.localeCompare(b.name);
    });
  };

  const filteredFiles = (() => {
    const base = allFiles.filter(file => {
      const matchSearch = file.name.toLowerCase().includes(fileSearch.toLowerCase()) || 
                         file.type.toLowerCase().includes(fileSearch.toLowerCase());
      const matchArchive = showArchived ? file.isArchived : !file.isArchived;
      
      let matchVersion = true;
      if (versionFilter === 'CURRENT') {
        matchVersion = file.version === currentVersion && file.caseId === currentCaseId;
      } else if (versionFilter === 'ORPHAN') {
        matchVersion = !file.version || !file.caseId;
      } else if (versionFilter !== 'ALL') {
        matchVersion = file.version === versionFilter;
      }

      return matchSearch && matchArchive && matchVersion;
    });

    if (fileSortBy === 'ORDER') return sortFilesOrdered(base);

    return base.sort((a, b) => {
      if (fileSortBy === 'id') return a.id.localeCompare(b.id);
      if (fileSortBy === 'name') return a.name.localeCompare(b.name);
      if (fileSortBy === 'type') return a.type.localeCompare(b.type);
      if (fileSortBy === 'date') return b.timestamp - a.timestamp;
      if (fileSortBy === 'batch') return (a.batchId || '').localeCompare(b.batchId || '');
      return 0;
    });
  })();

  const archiveFile = (id: string) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, isArchived: true } : f));
  };

  const restoreFile = (id: string) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, isArchived: false } : f));
  };

  const deleteFile = async (id: string) => {
    setConfirmDialog({
      title: 'SMAZAT SOUBOR',
      message: 'Opravdu chcete smazat tento konkrétní soubor ze systému?',
      onConfirm: async () => {
        setUploadedFiles(prev => prev.filter(f => f.id !== id));
        setSelectedFileIds(prev => prev.filter(fId => fId !== id));
        setSupportFileIds(prev => prev.filter(fId => fId !== id));

        if (user) {
          if (isFirebaseQuotaExceeded) {
            console.warn("Cloud deletion bypassed during Free Tier quota limit.");
            return;
          }
          try {
            await deleteDoc(doc(db, `users/${user.uid}/files`, id));
          } catch (e: any) {
            console.error("Chyba při mazání souboru z cloudu:", e);
            if (e && (e.message?.includes('quota') || e.code === 'resource-exhausted' || e.message?.includes('exhausted'))) {
              setIsFirebaseQuotaExceeded(true);
            }
          }
        }
      }
    });
  };

  const speakText = (text?: string) => {
    if (!text) return;
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text.substring(0, 500)); // Sample start
    utterance.lang = 'cs-CZ';
    utterance.rate = 0.9;
    synth.speak(utterance);
  };

  const clearAllData = async () => {
    setConfirmDialog({
      title: 'ABSOLUTNÍ DESTRUKCE DAT (RESET SYSTÉMU)',
      message: 'VAROVÁNÍ: Opravdu chcete smazat ABSOLUTNĚ VŠECHNA data? Tato akce nevratně odstraní všechny spisy, soubory, indexy i historii úloh z lokálního úložiště i cloudu.',
      onConfirm: async () => {
        isResetting.current = true;
        localStorage.clear();
        // Secondary explicit clear for known keys
        const keys = ['juris_files', 'juris_queue', 'juris_strategy', 'juris_history', 'juris_cases', 'juris_current_case_id', 'juris_version', 'juris_git_context'];
        keys.forEach(k => localStorage.removeItem(k));
        
        if (user) {
          try {
            const batch = writeBatch(db);
            const filesSnap = await getDocs(collection(db, `users/${user.uid}/files`));
            filesSnap.forEach(d => batch.delete(d.ref));
            
            const queueSnap = await getDocs(collection(db, `users/${user.uid}/queue`));
            queueSnap.forEach(d => batch.delete(d.ref));
            
            const historySnap = await getDocs(collection(db, `users/${user.uid}/history`));
            historySnap.forEach(d => batch.delete(d.ref));
            
            const casesSnap = await getDocs(collection(db, `users/${user.uid}/cases`));
            casesSnap.forEach(d => batch.delete(d.ref));
            
            batch.delete(doc(db, `users/${user.uid}/settings`, 'current'));
            await batch.commit();
          } catch (e) {
            console.error("Chyba při mazání databáze z cloudu:", e);
          }
        }

        // Force reload to clean state
        window.location.href = window.location.origin + window.location.pathname;
      }
    });
  };

  const toggleFileSelection = (id: string, type: 'SELECT' | 'SUPPORT' | 'BULK') => {
    if (type === 'BULK') {
      setSelectedBulkIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
      return;
    }
    if (type === 'SELECT') {
      setSelectedFileIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    } else {
      setSupportFileIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    }
  };

  const setBulkCategory = (category: FileEntry['category']) => {
    if (selectedBulkIds.length === 0) return;
    setUploadedFiles(prev => prev.map(f => selectedBulkIds.includes(f.id) ? { ...f, category } : f));
    setSelectedBulkIds([]);
  };

  const bulkAction = async (action: 'DELETE' | 'ARCHIVE' | 'ASSIGN_CURRENT' | 'ADD_TO_AUDIT' | 'RENAME_VERSION') => {
    if (selectedBulkIds.length === 0) return;
    
    if (action === 'DELETE') {
      setConfirmDialog({
        title: 'HROMADNÉ SMAZÁNÍ SOUBORŮ',
        message: `Opravdu chcete smazat ${selectedBulkIds.length} vybraných souborů ze systému? Tato akce je nevratná.`,
        onConfirm: async () => {
          const idsToRemove = new Set(selectedBulkIds);
          setUploadedFiles(prev => prev.filter(f => !idsToRemove.has(f.id)));
          setSelectedFileIds(prev => prev.filter(id => !idsToRemove.has(id)));
          setSupportFileIds(prev => prev.filter(id => !idsToRemove.has(id)));
          
          if (user) {
            try {
              const batch = writeBatch(db);
              selectedBulkIds.forEach(id => {
                batch.delete(doc(db, `users/${user.uid}/files`, id));
              });
              await batch.commit();
            } catch (e) {
              console.error("Chyba při hromadném mazání souborů z cloudu:", e);
            }
          }

          setSelectedBulkIds([]);
        }
      });
      return;
    } 
    
    if (action === 'ARCHIVE') {
      const idsToArchive = new Set(selectedBulkIds);
      setUploadedFiles(prev => prev.map(f => idsToArchive.has(f.id) ? { ...f, isArchived: true } : f));
      setSelectedBulkIds([]);
      return;
    } 
    
    if (action === 'ASSIGN_CURRENT') {
      const idsToAssign = new Set(selectedBulkIds);
      setUploadedFiles(prev => prev.map(f => idsToAssign.has(f.id) ? { ...f, caseId: currentCaseId, version: currentVersion } : f));
      setSelectedBulkIds([]);
      setTimeout(() => alert(`${idsToAssign.size} souborů bylo přiřazeno k aktuálnímu spisu a verzi (${currentVersion}).`), 100);
      return;
    }

    if (action === 'ADD_TO_AUDIT') {
      const idsToAdd = selectedBulkIds.filter(id => !selectedFileIds.includes(id));
      setSelectedFileIds(prev => [...prev, ...idsToAdd]);
      setSelectedBulkIds([]);
      return;
    }

    if (action === 'RENAME_VERSION') {
      const suggested = uploadedFiles.find(f => selectedBulkIds.includes(f.id))?.version || currentVersion;
      const newVer = prompt('Zadejte nový název verze pro vybrané soubory (Hromadně):', suggested);
      if (newVer) {
        const idsToUpdate = new Set(selectedBulkIds);
        setUploadedFiles(prev => prev.map(f => idsToUpdate.has(f.id) ? { ...f, version: newVer } : f));
        setSelectedBulkIds([]);
        setCurrentVersion(newVer);
      }
      return;
    }
  };

  const assignVersionToCase = (versionName: string) => {
    const targetCaseId = prompt('Zadejte cílové ID spisu (např. C01, C02...):', currentCaseId);
    if (targetCaseId && cases.some(c => c.id === targetCaseId)) {
      setUploadedFiles(prev => prev.map(f => f.version === versionName ? { ...f, caseId: targetCaseId } : f));
      setTimeout(() => alert(`VERZE ${versionName} BYLA PŘESUNUTA DO SPISU ${cases.find(c => c.id === targetCaseId)?.nr || targetCaseId}`), 100);
    } else if (targetCaseId) {
      alert('Chybné ID spisu.');
    }
  };

  const createNewVersionManually = () => {
    const name = prompt('Název nové verze (např. F16_REV):');
    if (name) {
      setCurrentVersion(name.toUpperCase());
      alert(`AKTIVNÍ VERZE NASTAVENA NA: ${name.toUpperCase()}`);
    }
  };

  const createNewCase = () => {
    setShowCaseModal(true);
    const defaultNr = `${new Date().getFullYear()}/LG/${cases.length + 10}`;
    setNewCaseData({ name: 'Nový případ ' + (cases.length + 1), nr: defaultNr });
  };

  const confirmCreateCase = () => {
    if (!newCaseData.name || !newCaseData.nr) return;

    const newId = `C-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const newCase = { 
      id: newId, 
      name: newCaseData.name.trim(), 
      nr: newCaseData.nr.trim(), 
      activeVersion: 'V1.0.0' 
    };
    
    setCases(prev => [...prev, newCase]);
    setCurrentCaseId(newId);
    setCurrentVersion('V1.0.0');
    
    // Reset selection context for the new case
    setSelectedFileIds([]);
    setSupportFileIds([]);
    setInputText('');
    setReviewResult(null);
    setShowCaseModal(false);
  };

  const getFileColor = (file: FileEntry) => {
    if (file.isArchived) return 'border-[#222] bg-[#0d0d0d] opacity-30 grayscale';
    
    switch(file.category) {
      case 'MAIN': return 'border-[#C5A059]/40 bg-[#C5A059]/5';
      case 'SKILLS': return 'border-amber-500/30 bg-amber-950/10 shadow-[inner_0_0_10px_rgba(245,158,11,0.1)]';
      case 'ATTACH': return 'border-blue-900/40 bg-blue-950/10';
      case 'SUPPORT': return 'border-emerald-900/40 bg-emerald-950/10';
      case 'SYSTEM': return 'border-purple-900/40 bg-purple-950/10';
      default: return 'border-[#333] bg-[#151515]';
    }
  };

  const addToQueue = () => {
    let selectedFiles: FileEntry[] = [];
    let versionLabel = currentVersion;

    if (selectionMode === 'VERSIONS') {
      if (compareVersionIds.length === 0) {
        alert('VYBERTE ALESPOŇ JEDNU VERZI PRO PŘIDÁNÍ DO FRONTY.');
        return;
      }
      selectedFiles = allFiles.filter(f => compareVersionIds.includes(f.version || ''));
      versionLabel = compareVersionIds.join(' + ');
    } else {
      if (selectedFileIds.length === 0) {
        alert('VYBERTE SOUBORY PRO PŘIDÁNÍ DO FRONTY.');
        return;
      }
      selectedFiles = allFiles.filter(f => selectedFileIds.includes(f.id));
    }
    
    const supportFiles = allFiles.filter(f => supportFileIds.includes(f.id));
    const selectedPillars = auditPillars.filter(p => selectedPillarIds.includes(p.id));
    
    if (selectedPillars.length === 0) {
      alert('VYBERTE ALESPOŇ JEDNU ANALÝZU (PILÍŘ).');
      return;
    }

    const newTasks: AuditTask[] = [];

    if (selectionMode === 'VERSIONS' && compareVersionIds.length === 2) {
      const v1 = compareVersionIds[0];
      const v2 = compareVersionIds[1];
      const filesV1 = allFiles.filter(f => f.version === v1);
      const filesV2 = allFiles.filter(f => f.version === v2);

      // Find common files by name
      const commonNames = filesV1.filter(f1 => filesV2.some(f2 => f2.name === f1.name)).map(f => f.name);

      if (commonNames.length > 0) {
        commonNames.forEach(name => {
          newTasks.push({
            id: `Q-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
            files: [name],
            supportFiles: supportFiles.map(f => f.name),
            pillars: selectedPillars.map(p => p.name),
            status: 'pending',
            timestamp: Date.now(),
            version: `${v1} ➔ ${v2} (${name})`
          });
        });
        
        // Also add a summary task
        newTasks.push({
            id: `Q-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
            files: commonNames,
            supportFiles: supportFiles.map(f => f.name),
            pillars: ['Diferenční Analýza'],
            status: 'pending',
            timestamp: Date.now(),
            version: `${v1} ➔ ${v2} (CELKOVÝ SUMÁŘ)`
        });
      } else {
        // Fallback to combined if no common names found
        newTasks.push({
          id: `Q-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
          files: selectedFiles.map(f => f.name),
          supportFiles: supportFiles.map(f => f.name),
          pillars: selectedPillars.map(p => p.name),
          status: 'pending',
          timestamp: Date.now(),
          version: versionLabel
        });
      }
    } else if (queueStrategy === 'COMBINE') {
      newTasks.push({
        id: `Q-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
        files: selectedFiles.map(f => f.name),
        supportFiles: supportFiles.map(f => f.name),
        pillars: selectedPillars.map(p => p.name),
        status: 'pending',
        timestamp: Date.now(),
        version: versionLabel
      });
    } else if (queueStrategy === 'PER_FILE') {
      selectedFiles.forEach(mainFile => {
        const otherSelected = selectedFiles.filter(f => f.id !== mainFile.id).map(f => f.name);
        newTasks.push({
          id: `Q-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
          files: [mainFile.name],
          supportFiles: [...otherSelected, ...supportFiles.map(f => f.name)],
          pillars: selectedPillars.map(p => p.name),
          status: 'pending',
          timestamp: Date.now(),
          version: mainFile.version || versionLabel
        });
      });
    } else if (queueStrategy === 'CROSS') {
      selectedFiles.forEach(mainFile => {
        const otherSelected = selectedFiles.filter(f => f.id !== mainFile.id).map(f => f.name);
        selectedPillars.forEach(pillar => {
          newTasks.push({
            id: `Q-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
            files: [mainFile.name],
            supportFiles: [...otherSelected, ...supportFiles.map(f => f.name)],
            pillars: [pillar.name],
            status: 'pending',
            timestamp: Date.now(),
            version: mainFile.version || versionLabel
          });
        });
      });
    }

    setAuditQueue(prev => [...newTasks, ...prev]);
  };

  const toggleAllPillars = (select: boolean) => {
    if (select) {
      setSelectedPillarIds(auditPillars.map(p => p.id));
    } else {
      setSelectedPillarIds([]);
    }
  };

  const handleReview = async (taskId?: string) => {
    const isMainInputPresent = inputText.trim().length > 0;
    const isSelectionPresent = selectionMode === 'FILES' ? selectedFileIds.length > 0 : compareVersionIds.length > 0;
    
    if (!isMainInputPresent && !isSelectionPresent && !taskId) {
      alert('CHYBÍ VSTUPNÍ DATA PRO ANALÝZU.');
      return;
    }

    setIsReviewing(true);
    setError(null);
    if (!taskId) setReviewResult(null);

    let targetFiles: string[] = [];
    let supportFiles: string[] = [];
    let targetPillars: string[] = [];
    let selectedFilesObjects: FileEntry[] = [];
    let processingTaskId = taskId;
    if (processingTaskId) setCurrentProcessingId(processingTaskId);

    if (taskId) {
      const task = auditQueue.find(t => t.id === taskId);
      if (task) {
        // Find files by name and version to ensure correct content
        selectedFilesObjects = allFiles.filter(f => 
          task.files.includes(f.name) && 
          (!task.version || task.version.includes(f.version || ''))
        );
        targetFiles = selectedFilesObjects.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content || '[Obsah nelze extrahovat nebo je prázdný]'}`);
        
        const supportFilesObjects = allFiles.filter(f => 
          task.supportFiles.includes(f.name) &&
          (!task.version || task.version.includes(f.version || ''))
        );
        supportFiles = supportFilesObjects.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content || '[Obsah nelze extrahovat]'}`);
        
        targetPillars = task.pillars;
        setAuditQueue(prev => prev.map(t => t.id === taskId ? { ...t, status: 'processing' } : t));
      }
    } else {
      selectedFilesObjects = allFiles.filter(f => {
        if (selectionMode === 'VERSIONS') {
          return compareVersionIds.includes(f.version || '');
        }
        return selectedFileIds.includes(f.id);
      });
      targetFiles = selectedFilesObjects.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content || '[Obsah prázdný]'}`);
      
      const supportFilesObjects = allFiles.filter(f => supportFileIds.includes(f.id));
      supportFiles = supportFilesObjects.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content || '[Obsah prázdný]'}`);
      
      targetPillars = auditPillars.filter(p => selectedPillarIds.includes(p.id)).map(p => p.name);
    }

    try {
      let mode: 'AUDIT' | 'COMPOSE' | 'VERSION_DIFF' | 'VERTICAL_DIFF' | 'BEST_COMBO_SYNTHESIS' = 'AUDIT';
      if (!taskId) {
        if (appMode === 'VERTICAL') {
          mode = 'VERTICAL_DIFF';
        } else if (appMode === 'SYNTHESIS') {
          mode = 'BEST_COMBO_SYNTHESIS';
        } else if (selectionMode === 'VERSIONS' && compareVersionIds.length === 2) {
          mode = 'VERSION_DIFF';
        } else {
          mode = appMode as any;
        }
      }

      // Filter out 'SKILLS' files from main targetFiles to prevent them from being analyzed as the petition itself
      const nonSkillTargetFiles = taskId ? targetFiles : selectedFilesObjects
        .filter(f => f.category !== 'SKILLS')
        .map(f => `SOUBOR_K_ANALYZE: ${f.name}\nOBSAH:\n${f.content || '[Obsah prázdný]'}`);

      const activeSkills = allFiles.filter(f => selectedFileIds.includes(f.id) && f.category === 'SKILLS');
      const skillsData = activeSkills.map(f => `NÁZEV METODIKY/SKILLU: ${f.name}\nKOMPLETNÍ METODICKÝ POSTUP:\n${f.content || ''}`);

      const otherInsights = allFiles
        .filter(f => f.version === (selectedFilesObjects.length > 0 ? selectedFilesObjects[0].version : currentVersion) && f.insight)
        .map(f => `SOUBOR: ${f.name} - VHLED: ${f.insight}`)
        .join('\n');

      const combinedInstructions = `${notes}\n\nRELAČNÍ_KONTEXT_PODÁNÍ (Indexované vhledy):\n${otherInsights}\n\nEXTERNAL_CONTEXT:\n${gitContext}`;
      const result = await reviewCourtRequest(inputText, nonSkillTargetFiles, targetPillars, supportFiles, combinedInstructions, mode, compareVersionIds, skillsData);
      if (processingTaskId) {
        setAuditQueue(prev => prev.map(t => t.id === processingTaskId ? { ...t, status: 'done', result: result || undefined, isNotified: true } : t));
        setActiveQueueId(processingTaskId);
        setTimeout(() => setAuditQueue(prev => prev.map(t => t.id === processingTaskId ? { ...t, isNotified: false } : t)), 5000);
      } else {
        setReviewResult(result || null);
      }
      
      // Auto-focus the output section
      setTimeout(() => {
        const outputElement = document.getElementById('audit-output');
        if (outputElement) outputElement.scrollIntoView({ behavior: 'smooth' });
      }, 300);

    } catch (err: any) {
      setError(err.message || 'Error occurred');
      if (processingTaskId) setAuditQueue(prev => prev.map(t => t.id === processingTaskId ? { ...t, status: 'pending' } : t));
    } finally {
      setIsReviewing(false);
      setCurrentProcessingId(null);
    }
  };

  const executeAllQueue = async () => {
    const pendingTasks = [...auditQueue].filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) return;
    
    setIsQueueRunning(true);
    stopRequestedRef.current = false;
    for (const task of pendingTasks) {
      if (stopRequestedRef.current) break;
      await handleReview(task.id);
    }
    setIsQueueRunning(false);
    stopRequestedRef.current = false;
  };

  const stopQueue = () => {
    stopRequestedRef.current = true;
    setIsQueueRunning(false);
  };

  const clearQueue = () => {
    setConfirmDialog({
      title: 'VYMAZÁNÍ FRONTY ÚLOH',
      message: 'Opravdu chcete vymazat celou frontu úloh z registru (včetně hotových)?',
      onConfirm: () => {
        setAuditQueue([]);
        setActiveQueueId(null);
      }
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const batchId = uploadBatchId || `B-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const firstFileName = files[0].name.split('.')[0].toUpperCase();
    
    // Auto-Versioning: If this is a fresh batch, suggest a new version name based on the file
    if (!uploadBatchId) {
      const suggestedVersion = files.length === 1 ? firstFileName : batchId;
      setCurrentVersion(suggestedVersion);
    }

    const newFiles: FileEntry[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      // Use the batch ID or the specific file suggested version
      const fileVersion = files.length === 1 ? firstFileName : (uploadBatchId ? currentVersion : firstFileName);
      const newFileId = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

      if (ext === 'json') {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const content = JSON.parse(e.target?.result as string);
            if (content.atoms) {
              setConfirmDialog({
                title: 'NALEZENY DATOVÉ ATOMY',
                message: 'Chcete detekované datové atomy integrovat do aktuálního návrhu strukturních doložek?',
                onConfirm: () => {
                  setInputText(prev => prev + '\n\n// INTEGROVANÉ ATOMY:\n' + JSON.stringify(content.atoms, null, 2));
                }
              });
            }
          } catch (err) { console.error('JSON parse error', err); }
        };
        reader.readAsText(file);
      }

      if (ext === 'zip') {
        const zip = new JSZip();
        try {
          const content = await zip.loadAsync(file);
          const zipVersion = file.name.replace('.zip', '').toUpperCase();
          setCurrentVersion(zipVersion); // Auto-focus this zip as its own version

          for (const [path, entry] of Object.entries(content.files)) {
            if (!entry.dir) {
              const fileId = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
              const fileContent = await entry.async('string');
              
              newFiles.push({ 
                id: fileId, 
                name: entry.name, type: entry.name.split('.').pop()?.toUpperCase() || 'ZIP_ITEM', 
                isUploaded: true, timestamp: Date.now(), batchId,
                category: (zipVersion.toLowerCase().includes('skil') || entry.name.toLowerCase().includes('skil')) ? 'SKILLS' : 'ATTACH', version: zipVersion, caseId: currentCaseId,
                content: fileContent,
                indexStatus: 'IDLE'
              });

              if (driveToken) {
                backgroundUploadToDrive(entry.name, fileContent, zipVersion);
              }
            }
          }
        } catch (err) {
          console.error("Failed to load ZIP", err);
        }
      } else if (ext === 'docx') {
        const docxFileId = newFileId;
        newFiles.push({ 
          id: docxFileId, 
          name: file.name, type: 'DOCX', isUploaded: true, timestamp: Date.now(), batchId,
          category: (currentVersion.toLowerCase().includes('skil') || file.name.toLowerCase().includes('skil')) ? 'SKILLS' : 'ATTACH', version: currentVersion, caseId: currentCaseId,
          indexStatus: 'INDEXING',
          content: 'Parsování dokumentu...'
        });

        const fileReader = new FileReader();
        fileReader.onload = async (e) => {
          try {
            if (e.target?.result) {
              const zip = await JSZip.loadAsync(e.target.result as ArrayBuffer);
              const docXmlFile = zip.file("word/document.xml");
              if (!docXmlFile) {
                throw new Error("Chybí word/document.xml");
              }
              const xmlContent = await docXmlFile.async("text");
              const wtRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
              let match;
              const textParts: string[] = [];
              while ((match = wtRegex.exec(xmlContent)) !== null) {
                textParts.push(match[1]);
              }
              const text = textParts.join(" ")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .trim();
              
              setUploadedFiles(prev => prev.map(f => f.id === docxFileId ? { ...f, content: text, indexStatus: 'IDLE' } : f));
              if (driveToken) {
                backgroundUploadToDrive(file.name, text, currentVersion);
              }
            }
          } catch (err: any) {
            console.error("Docx parsing failed:", err);
            const errMsg = `[Chyba parsování DOCX]: ${err?.message || String(err)}`;
            setUploadedFiles(prev => prev.map(f => f.id === docxFileId ? { ...f, content: errMsg, indexStatus: 'ERROR' } : f));
          }
        };
        fileReader.readAsArrayBuffer(file);
      } else {
        const isText = ext && ['txt', 'json', 'md', 'csv', 'xml', 'yaml', 'yml', 'html', 'js', 'ts', 'jsx', 'tsx'].includes(ext);
        let initialContent = '';
        if (!isText) {
          if (ext === 'pdf') {
            initialContent = `[Nahraný binární PDF soubor: ${file.name}. Pro plnou analýzu doporučujeme převedení PDF do Google Dokumentů nebo čistého textu.]`;
          } else {
            initialContent = `[Nahraný binární soubor: ${file.name} (${ext?.toUpperCase() || 'BIN'}). Pro plnou analýzu doporučujeme nahrát v textovém formátu.]`;
          }
        }

        newFiles.push({ 
          id: newFileId, 
          name: file.name, type: ext?.toUpperCase() || 'FILE', isUploaded: true, timestamp: Date.now(), batchId,
          category: (currentVersion.toLowerCase().includes('skil') || file.name.toLowerCase().includes('skil')) ? 'SKILLS' : 'ATTACH', version: currentVersion, caseId: currentCaseId,
          indexStatus: 'IDLE',
          content: initialContent
        });

        if (isText) {
          const fileReader = new FileReader();
          fileReader.onload = (e) => {
            const content = e.target?.result as string;
            setUploadedFiles(prev => prev.map(f => f.id === newFileId ? { ...f, content } : f));
            if (driveToken) {
              backgroundUploadToDrive(file.name, content, currentVersion);
            }
          };
          fileReader.readAsText(file);
        } else {
          if (driveToken) {
            backgroundUploadToDrive(file.name, initialContent, currentVersion);
          }
        }
      }
    }
    setUploadedFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const createNewVersion = () => {
    const vMatch = currentVersion.match(/V(\d+)\.?(\d+)?/);
    let nextVersion = 'V2.0';
    if (vMatch) {
      const main = parseInt(vMatch[1]);
      nextVersion = `V${main + 1}.0`;
    }
    
    const snapshot: VersionRecord = {
      id: Math.random().toString(36).substr(2, 6).toUpperCase(),
      version: currentVersion,
      text: inputText,
      timestamp: Date.now(),
      selectedFiles: [...selectedFileIds],
      selectedPillars: [...selectedPillarIds]
    };

    setHistory(prev => [snapshot, ...prev]);
    setCurrentVersion(nextVersion);
  };

  const restoreVersion = (v: VersionRecord) => {
    setInputText(v.text);
    setCurrentVersion(v.version);
    setSelectedFileIds(v.selectedFiles);
    setSelectedPillarIds(v.selectedPillars);
    setShowHistory(false);
  };

  const togglePillarSelection = (id: string) => {
    setSelectedPillarIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const removeFromQueue = (id: string) => {
    setAuditQueue(prev => prev.filter(t => t.id !== id));
  };

  const handleCopy = () => {
    if (reviewResult) {
      navigator.clipboard.writeText(reviewResult);
      alert('Kopírováno do schránky');
    }
  };

  const deleteHistoryItem = async (id: string) => {
    setHistory(prev => prev.filter(h => h.id !== id));
    setCompareVersionIds(prev => prev.filter(vId => vId !== id));
    
    if (user) {
      if (isFirebaseQuotaExceeded) {
        console.warn("Cloud history deletion bypassed during Free Tier quota limit.");
        return;
      }
      try {
        await deleteDoc(doc(db, `users/${user.uid}/history`, id));
      } catch (e: any) {
        console.error("Chyba při mazání záznamu historie z cloudu:", e);
        if (e && (e.message?.includes('quota') || e.code === 'resource-exhausted' || e.message?.includes('exhausted'))) {
          setIsFirebaseQuotaExceeded(true);
        }
      }
    }
  };

  const toggleCompare = (id: string) => {
    setCompareVersionIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id].slice(-2)
    );
  };

  const parseJsonFromResult = (result?: string) => {
    if (!result) return null;
    const match = result.match(/```json\s?([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        // Fallback for non-standard JSON blocks
        try {
           const simpleMatch = result.match(/\{[\s\S]*\}/);
           if (simpleMatch) return JSON.parse(simpleMatch[0]);
        } catch { return null; }
      }
    }
    return null;
  };

  const getNextVersion = (ver: string): string => {
    const match = ver.match(/([a-zA-Z]+)(\d+)(\.?\d*)/);
    if (match) {
      const prefix = match[1];
      const num = parseInt(match[2], 10);
      const suffix = match[3];
      if (suffix && !isNaN(parseFloat(suffix))) {
        const nextNum = (parseFloat(num + suffix) + 1).toFixed(1);
        return `${prefix}${parseFloat(nextNum)}`;
      }
      return `${prefix}${num + 1}`;
    }
    return `${ver}_REV`;
  };

  const generateFixAnalysisInstructions = async () => {
    const activeResultMD = activeQueueId 
      ? auditQueue.find(t => t.id === activeQueueId)?.result 
      : reviewResult;
    
    if (!activeResultMD) {
      alert("Nebyly nalezeny žádné výsledky auditu, na základě kterých by bylo možné vypsat nápravný list.");
      return;
    }

    setIsGeneratingFixAnalysis(true);
    setFixAnalysisText(null);

    try {
      const mainFiles = uploadedFiles.filter(f => f.caseId === currentCaseId && f.category === 'MAIN');
      const textToFix = mainFiles.map(f => `[SOUBOR: ${f.name} - ${f.version}]:\n${f.content}`).join("\n\n---\n\n") || "Žádný hlavní draft neuveden.";

      const promptInstructions = `Na základě výsledků předchozího Juris-Auditu:
      ${activeResultMD}

      Sestav vysoce detailní "Nápravný list (Fix Analysis)" obsahující přesné pokyny pro úpravu, bod po bodu. 
      Napiš jaké konkrétní pasáže, věty a argumentační odstavce musí právní zástupce doplnit, smazat nebo reformulovat, aby byly splněny pilíře §LG13§.
      Uveď vzorové příklady lepších formulací v profesionální české právní mluvě.`;

      const result = await reviewCourtRequest(
        textToFix,
        [],
        selectedPillarIds,
        [],
        promptInstructions,
        'COMPOSE'
      );

      setFixAnalysisText(result);
    } catch (e) {
      console.error(e);
      alert("Chyba při generování pokynů k nápravě.");
    } finally {
      setIsGeneratingFixAnalysis(false);
    }
  };

  const generateUpgradeToNextVersion = async () => {
    const activeResultMD = activeQueueId 
      ? auditQueue.find(t => t.id === activeQueueId)?.result 
      : reviewResult;
    
    const activeVer = activeQueueId
      ? (auditQueue.find(t => t.id === activeQueueId)?.version || currentVersion)
      : currentVersion;

    const nextVer = getNextVersion(activeVer);

    if (!activeResultMD) {
      alert("Nebyly nalezeny žádné výsledky auditu, které by se daly zapracovat do nového draftu.");
      return;
    }

    setConfirmDialog({
      title: 'VÝVOJ NOVÉ VERZE DRAFTU',
      message: `Služba nyní vezme váš aktuální draft a doporučení z auditu, sloučí je a vyvine automaticky novou vylepšenou verzi s označením '${nextVer}'. Chcete pokračovat?`,
      onConfirm: async () => {
        setIsGeneratingUpgrade(true);

        try {
          const activeFilesToRewrite = uploadedFiles.filter(f => f.caseId === currentCaseId && f.version === activeVer && f.category === 'MAIN');
          if (activeFilesToRewrite.length === 0) {
            alert(`Nenašel jsem žádný hlavní soubor z verze ${activeVer} k vylepšení a revizi.`);
            setIsGeneratingUpgrade(false);
            return;
          }

          const targetFile = activeFilesToRewrite[0];

          const promptInstructions = `Na základě výsledků předchozího Juris-Auditu:
          ${activeResultMD}

          Tady jsou extra doporučení pro přepracování:
          ${fixAnalysisText || ''}

          Úkol: Přepiš a vylepši dodaný hlavní text dokumentu tak, aby stoprocentně vyhovoval všem auditním pilířům, eliminoval veškere nalezené procesní a právní slabiny, a implementoval doporučení ze seznamu výše. 
          Výsledný text musí být kompletní, plně vyargumentovaný a připravený k podání.
          Vytvoř novou, vylepšenou verzi, která překonává dosavadní nedostatky.`;

          const resultText = await reviewCourtRequest(
            targetFile.content || '',
            [],
            selectedPillarIds,
            [],
            promptInstructions,
            'COMPOSE'
          );

          const newFileId = `U-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
          const newFileName = targetFile.name.replace(activeVer, nextVer).includes(nextVer) 
            ? targetFile.name 
            : `UPGRADE_${nextVer}_${targetFile.name}`;

          const upgradedFileEntry: FileEntry = {
            id: newFileId,
            name: newFileName,
            type: targetFile.type,
            isUploaded: true,
            timestamp: Date.now(),
            batchId: targetFile.batchId || `UP-${nextVer.toUpperCase()}`,
            category: 'MAIN',
            version: nextVer,
            caseId: currentCaseId,
            content: resultText,
            indexStatus: 'IDLE'
          };

          setUploadedFiles(prev => [...prev, upgradedFileEntry]);
          setCurrentVersion(nextVer);
          setVersionFilter(nextVer);
          
          alert(`Gratulujeme! Nová verze '${nextVer}' byla úspěšně vygenerována ze zdrojů, zařazena do registru a byla spuštěna její automatická pre-indexace v pozadí.`);
        } catch (e) {
          console.error(e);
          alert("Chyba při upgradování návrhu na novou verzi.");
        } finally {
          setIsGeneratingUpgrade(false);
        }
      }
    });
  };

  const getRechartsData = () => {
    const uniqVersions = Array.from(
      new Set(uploadedFiles.filter(f => f.caseId === currentCaseId).map(f => f.version))
    ).filter(Boolean) as string[];

    uniqVersions.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });

    return uniqVersions.map(ver => {
      const matchingTask = [...auditQueue]
        .reverse()
        .find(t => t.version === ver && t.status === 'done' && t.result);
      
      const parsed = matchingTask ? parseJsonFromResult(matchingTask.result) : null;
      const files = uploadedFiles.filter(f => f.caseId === currentCaseId && f.version === ver);
      const wordCount = files.reduce((acc, f) => acc + (f.content?.split(/\s+/).length || 0), 0);
      
      const verNumber = parseInt(ver.replace(/\D/g, ''), 10) || 12;
      const baseScore = Math.min(98, Math.max(45, 55 + (verNumber * 1.5) + (files.length * 2)));
      const baseStrength = Math.min(95, Math.max(40, 50 + (verNumber * 1.8) + (wordCount > 500 ? 5 : 0)));
      const baseProb = Math.min(90, Math.max(35, 45 + (verNumber * 1.3)));
      const baseRisk = Math.max(5, Math.min(85, 90 - (verNumber * 2.1) - (files.length * 3)));

      return {
        name: ver,
        Integrita: parsed?.score !== undefined ? parsed.score : Math.round(baseScore),
        Sila: parsed?.metrics?.strength !== undefined ? parsed.metrics.strength : Math.round(baseStrength),
        Uspesnost: parsed?.metrics?.probability !== undefined ? parsed.metrics.probability : Math.round(baseProb),
        Riziko: parsed?.metrics?.complexity !== undefined ? parsed.metrics.complexity : Math.round(baseRisk),
        filesCount: files.length,
        isReal: !!matchingTask
      };
    });
  };

  const getPillarPerformanceData = () => {
    const completedTasks = auditQueue.filter(t => t.status === 'done' && t.caseId === currentCaseId);
    
    const pillarsList = [
      { id: 'P01', name: 'Značky' },
      { id: 'P02', name: 'Soulad' },
      { id: 'P03', name: 'Paradoxy' },
      { id: 'P04', name: 'Asymetrie' },
      { id: 'P05', name: 'Cirkularita' },
      { id: 'P06', name: 'Integrita' },
      { id: 'P07', name: 'Atomy' },
      { id: 'P08', name: 'Red Team' },
      { id: 'P09', name: 'Hierarchie' },
      { id: 'P10', name: 'Dieta' },
      { id: 'P11', name: 'Rizika' },
      { id: 'P12', name: 'Diference' },
      { id: 'P13', name: 'Admin' },
      { id: 'P14', name: 'Přílohy' },
    ];

    if (completedTasks.length === 0) {
      // exemplary demo data in case there are no active completed tasks
      return pillarsList.map((p, idx) => ({
        name: p.name,
        'Úspěšnost (%)': [85, 78, 92, 64, 88, 90, 75, 82, 89, 73, 80, 85, 91, 79][idx],
        'Aktivních auditů': [5, 4, 2, 3, 4, 5, 5, 2, 4, 3, 5, 4, 3, 4][idx]
      }));
    }

    return pillarsList.map(p => {
      const relevantTasks = completedTasks.filter(t => t.pillars.includes(p.id));
      let totalScore = 0;
      relevantTasks.forEach(t => {
        const parsed = parseJsonFromResult(t.result);
        totalScore += (parsed?.score || 85);
      });
      
      return {
        name: p.name,
        'Úspěšnost (%)': relevantTasks.length > 0 ? Math.round(totalScore / relevantTasks.length) : 0,
        'Aktivních auditů': relevantTasks.length
      };
    });
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-[#CCC] selection:bg-[#C5A059] selection:text-black font-sans">
      <AnimatePresence>
        {storageError && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-2xl px-4"
          >
            <div className="bg-red-950/90 border border-red-500 p-4 backdrop-blur-md flex items-start gap-4 shadow-2xl">
              <Database size={24} className="text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-[10px] font-black uppercase text-red-500 mb-1">Systémové Varování // Úložiště Plné</p>
                <p className="text-[11px] text-red-200 leading-relaxed font-medium">{storageError}</p>
                <div className="mt-3 flex gap-4">
                  <button onClick={() => setStorageError(null)} className="text-[9px] font-bold uppercase text-red-400 hover:text-white">Rozumím</button>
                  <button onClick={clearAllData} className="text-[9px] font-bold uppercase py-1 px-2 border border-red-500/50 hover:bg-red-500 hover:text-black">Smazat Vše (Reset)</button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <header className="mx-auto max-w-7xl px-6 py-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-8 border-b border-[#222]">
        <div className="relative">
          <div className="text-[11px] uppercase tracking-[0.3em] text-[#888] mb-6 flex items-center gap-2">
            <Scale size={14} className="text-[#C5A059]" />
            Profesionální Portál pro Audit Dokumentů
          </div>
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter leading-none select-none">
            §LG<span className="text-[#EAEAEA]">13</span>§<br/>
            <span className="text-transparent text-stroke opacity-30">TERMINÁL</span>
          </h1>
        </div>
          <div className="flex flex-col items-start md:items-end w-full md:w-auto">
            <div className="flex gap-4 items-center mb-4">
              {user ? (
                <div className="flex items-center gap-4 bg-[#111] border border-[#222] px-3 py-1.5">
                  <div className="flex flex-col items-end">
                    {isFirebaseOffline ? (
                      <span className="text-[9px] font-black text-rose-500 uppercase flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> Offline (Místní režim)
                      </span>
                    ) : (
                      <span className="text-[9px] font-black text-emerald-500 uppercase flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Cloud Sync Aktivní
                      </span>
                    )}
                    <span className="text-[8px] text-[#666]">{user.email}</span>
                  </div>
                  <button onClick={logout} className="p-1.5 text-[#444] hover:text-red-500 transition-colors" title="Odhlásit se">
                    <LogOut size={14} />
                  </button>
                  {isCloudSyncing && <RefreshCcw size={10} className="animate-spin text-[#C5A059]" />}
                </div>
              ) : (
                <button onClick={login} className="px-4 py-2 text-[10px] uppercase font-black bg-[#C5A059] text-black border border-[#C5A059] hover:bg-white transition-all flex items-center gap-2">
                  <LogIn size={12}/> Přihlásit se pro Cloud Sync
                </button>
              )}
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowHelp(true)} className="px-4 py-2 text-[10px] uppercase font-black border border-[#C5A059] text-[#C5A059] hover:bg-[#C5A059] hover:text-black transition-all flex items-center gap-2">
                <ShieldCheck size={12}/> README / HELP
              </button>
              <div className="flex items-center gap-2">
                <select 
                  value={currentCaseId} 
                  onChange={(e) => setCurrentCaseId(e.target.value)}
                  className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-black text-[#C5A059] outline-none cursor-pointer"
                >
                  {cases.map(c => <option key={c.id} value={c.id}>{c.nr} // {c.name}</option>)}
                </select>
                <button onClick={createNewCase} title="Vytvořit Nový Spis (Všechny parametry)" className="p-1.5 bg-[#C5A059] border border-[#C5A059] text-black hover:bg-white transition-all"><Plus size={14}/></button>
              </div>
              <button onClick={() => setShowHistory(!showHistory)} className={cn("px-4 py-2 text-[10px] uppercase font-black border transition-all flex items-center gap-2 relative", showHistory || compareVersionIds.length > 0 ? "bg-[#C5A059] text-black border-[#C5A059]" : "border-[#222] text-[#666] hover:border-[#444]")}>
                <History size={12}/> Historie {compareVersionIds.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] px-1 rounded-full">{compareVersionIds.length}</span>}
              </button>
              <div className="flex items-center gap-1 bg-[#111] border border-[#222] px-2" title="Aktuální verze / Kliknutím přejmenujete Snapshot">
                <span className="text-[8px] text-[#C5A059] uppercase font-black mr-2">Version</span>
                <input 
                  type="text" 
                  value={currentVersion} 
                  onChange={(e) => setCurrentVersion(e.target.value)} 
                  className="bg-transparent border-none text-[10px] font-black text-white w-16 outline-none text-center hover:bg-white/5 transition-colors"
                />
                <button onClick={createNewVersion} title="Vytvořit Snapshot (Záloha aktuálního stavu)" className="text-[#444] hover:text-[#C5A059] ml-2"><Layers size={10}/></button>
              </div>
            </div>
          <div className="text-[10px] font-mono text-[#444] uppercase tracking-widest px-2 py-1 mt-2 border border-[#222] flex items-center gap-2">
            STAV: AKTIVNÍ DOKUMENTACE <span className="text-[#C5A059]">SYNC: OK</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-20">
        {error && (
          <div className="mb-8 border border-red-900/50 bg-red-950/20 px-6 py-4 flex justify-between items-center rounded-sm">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <p className="text-xs text-red-400 font-mono uppercase tracking-widest leading-relaxed">
                {error}
              </p>
            </div>
            <button 
              onClick={() => setError(null)} 
              className="text-red-600 hover:text-white transition-colors p-1"
              title="Zavřít upozornění"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {isFirebaseQuotaExceeded && (
          <div className="mb-8 border border-amber-900/50 bg-amber-950/10 px-6 py-5 flex justify-between items-start rounded-sm">
            <div className="flex gap-4">
              <span className="w-2.5 h-2.5 mt-1 rounded-full bg-[#C5A059] animate-pulse shrink-0" />
              <div className="space-y-1">
                <h4 className="text-[10px] font-black uppercase text-[#C5A059] tracking-widest">AUTONOMNÍ LOKÁLNÍ REŽIM AKTIVNÍ</h4>
                <p className="text-xs text-[#AAA] font-mono leading-relaxed max-w-4xl">
                  Dosáhli jste bezplatného limitu zápisů do cloudové databáze (Free Tier Quota). 
                  Aplikace plynule přešla do plně autonomního offline režimu. 
                  Veškerá Vaše data, spisy i historie jsou bezpečně zrcadleny ve Vašem prohlížeči. 
                  Pro synchronizaci s cloudem stačí vyčkat na reset limitů.
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsFirebaseQuotaExceeded(false)} 
              className="text-amber-700 hover:text-white transition-colors p-1"
              title="Zavřít"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <AnimatePresence>
          {showHistory && (
            <motion.section initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mb-12 overflow-hidden border-b border-[#222] pb-12">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#C5A059] font-black">ARCHIV_VERZÍ_DOKUMENTU</h2>
                <div className="text-[9px] font-mono text-[#444] uppercase">Vyberte 2 pro porovnání</div>
              </div>
              <div className="grid gap-2">
                {history.map(item => (
                  <div key={item.id} className={cn("flex items-center justify-between p-4 border transition-all", compareVersionIds.includes(item.id) ? "border-[#C5A059] bg-[#C5A059]/10" : "border-[#222] bg-[#151515]")}>
                    <div className="flex items-center gap-6">
                      <div className="text-[10px] font-black text-[#888] w-12">{item.version}</div>
                      <div className="text-[9px] font-mono text-[#666]">{new Date(item.timestamp).toLocaleString()}</div>
                      <div className="text-[9px] text-[#555] max-w-xs truncate italic">{item.text.substring(0, 50)}...</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => toggleCompare(item.id)} className={cn("px-3 py-1 text-[9px] uppercase font-black border transition-all", compareVersionIds.includes(item.id) ? "bg-[#C5A059] text-black border-[#C5A059]" : "border-[#222] text-[#666] hover:border-white")}>Porovnat</button>
                      <button onClick={() => restoreVersion(item)} className="px-3 py-1 text-[9px] uppercase font-black border border-[#222] text-[#666] hover:border-emerald-500 hover:text-emerald-500 transition-all">Obnovit</button>
                      <button onClick={() => deleteHistoryItem(item.id)} className="p-1.5 text-red-950 hover:text-red-500 transition-all"><Trash2 size={14}/></button>
                    </div>
                  </div>
                ))}
                {history.length === 0 && <div className="text-center py-8 text-[10px] text-[#222] uppercase tracking-widest border border-dashed border-[#111]">Žádná historie záznamů</div>}
              </div>
              
              {compareVersionIds.length === 2 && (
                <div className="mt-8 border border-[#222] p-8 bg-[#050505]">
                  <div className="flex justify-between mb-4 border-b border-[#111] pb-2">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-[#C5A059]">Diferenční Analýza</h3>
                    <button onClick={() => setCompareVersionIds([])} className="text-[#444] hover:text-white"><X size={14}/></button>
                  </div>
                  <div className="grid grid-cols-2 gap-8 h-64 overflow-y-auto custom-scrollbar pr-4 italic font-serif text-[#777]">
                    <div>
                      <div className="text-[8px] uppercase text-[#333] mb-2">Původní ({history.find(h => h.id === compareVersionIds[0])?.version})</div>
                      <p className="text-xs">{history.find(h => h.id === compareVersionIds[0])?.text}</p>
                    </div>
                    <div>
                      <div className="text-[8px] uppercase text-[#333] mb-2">Cílová ({history.find(h => h.id === compareVersionIds[1])?.version})</div>
                      <p className="text-xs">{history.find(h => h.id === compareVersionIds[1])?.text}</p>
                    </div>
                  </div>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
        <section className="mb-12 mt-12">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
            <div>
              <div className="flex gap-4 mb-4">
                <button 
                  onClick={() => toggleSelectionMode('FILES')}
                  className={cn("text-[10px] font-black uppercase tracking-widest pb-1 transition-all", selectionMode === 'FILES' ? "text-[#C5A059] border-b-2 border-[#C5A059]" : "text-[#444] hover:text-[#666]")}
                >
                  Individuální Soubory
                </button>
                <button 
                  onClick={() => toggleSelectionMode('VERSIONS')}
                  className={cn("text-[10px] font-black uppercase tracking-widest pb-1 transition-all", selectionMode === 'VERSIONS' ? "text-[#C5A059] border-b-2 border-[#C5A059]" : "text-[#444] hover:text-[#666]")}
                >
                  Celá Podání (Verze)
                </button>
              </div>
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#444] font-black flex items-center gap-2">
                {selectionMode === 'FILES' ? '(00) REGISTRAČNÍ_INVENTÁŘ_SOUBORŮ' : '(00) EVOLUCE_PŘEDLOŽENÝCH_VERZÍ'}
                <span className="text-[#C5A059] ml-2">[{cases.find(c => c.id === currentCaseId)?.nr}]</span>
                {showArchived && <span className="text-amber-600 ml-2 animate-pulse">[ARCHIV]</span>}
              </h2>
              <div className="flex items-center gap-4 flex-wrap mt-2">
                <div className="relative">
                  <input type="text" value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} placeholder="FILTROVAT..." className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-mono tracking-widest text-[#666] outline-none focus:border-[#C5A059] transition-all w-40" />
                </div>
                {selectionMode === 'VERSIONS' && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        const currentVers = Array.from(new Set(uploadedFiles.filter(f => f.caseId === currentCaseId).map(f => f.version || '')));
                        setCompareVersionIds(currentVers.slice(0, 2));
                      }}
                      className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-black text-[#C5A059] hover:bg-[#C5A059] hover:text-black transition-all"
                    >
                      Označit Poslední 2 Verze
                    </button>
                    <button 
                      onClick={() => setCompareVersionIds([])}
                      className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-black text-[#444] hover:text-white transition-all"
                    >
                      Zrušit Výběr
                    </button>
                  </div>
                )}
                {selectionMode === 'FILES' && (
                  <div className="flex gap-2">
                    <select 
                      value={versionFilter} 
                      onChange={(e) => setVersionFilter(e.target.value as any)}
                      className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-black text-[#C5A059] outline-none"
                    >
                      <option value="ALL">VŠECHNY VERZE</option>
                      <option value="CURRENT">AKTUÁLNÍ PODÁNÍ ({currentVersion})</option>
                      <option value="ORPHAN">OSIŘELÉ SOUBORY</option>
                      <optgroup label="SPECIFICKÉ VERZE">
                        {Array.from(new Set(uploadedFiles.filter(f => f.version).map(f => f.version))).map(v => (
                          <option key={v} value={v!}>{v}</option>
                        ))}
                      </optgroup>
                    </select>
                    <button onClick={createNewVersionManually} title="Vytvořit Novou Verzi" className="px-3 bg-blue-900/40 border border-blue-900/60 text-blue-400 text-[10px] uppercase font-black hover:bg-blue-900 transition-all">Nový Upgrade</button>
                    <button onClick={toggleSelectAll} className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-black text-[#444] hover:text-white transition-all">
                      {(filteredFiles.length > 0 && filteredFiles.every(f => selectedBulkIds.includes(f.id))) ? 'Odznačit výběr' : 'Označit výběr'}
                    </button>
                  </div>
                )}
                {selectedBulkIds.length > 0 ? (
                  <div className="flex items-center gap-2 bg-[#C5A059]/10 border border-[#C5A059]/40 px-3 py-1 animate-in fade-in slide-in-from-left-2 transition-all">
                    <span className="text-[9px] font-black text-[#C5A059] mr-2">HROMADNĚ ({selectedBulkIds.length}):</span>
                    <button onClick={() => bulkAction('ADD_TO_AUDIT')} className="text-[9px] uppercase font-bold text-white hover:underline" title="Hromadně označit k auditu">Přidat k Auditu</button>
                    <div className="w-px h-3 bg-[#C5A059]/30 mx-2" />
                    <button onClick={() => bulkAction('RENAME_VERSION')} className="text-[9px] uppercase font-bold text-[#C5A059] hover:underline" title="Hromadně změnit název verze">Přejmenovat Verzi</button>
                    <div className="w-px h-3 bg-[#C5A059]/30 mx-2" />
                    <button onClick={() => setBulkCategory('MAIN')} className="text-[9px] uppercase font-bold text-white hover:underline">Hl. Podání</button>
                    <button onClick={() => setBulkCategory('ATTACH')} className="text-[9px] uppercase font-bold text-blue-400 hover:underline">Příloha</button>
                    <button onClick={() => setBulkCategory('SUPPORT')} className="text-[9px] uppercase font-bold text-emerald-400 hover:underline">Podpora</button>
                    <button onClick={() => setBulkCategory('SYSTEM')} className="text-[9px] uppercase font-bold text-purple-400 hover:underline">Systém</button>
                    <div className="w-px h-3 bg-[#C5A059]/30 mx-2" />
                    <button onClick={() => bulkAction('ASSIGN_CURRENT')} className="text-[9px] uppercase font-bold text-[#C5A059] hover:underline" title="Přiřadit k aktuálnímu spisu/verzi">Přiřadit k aktuálnímu</button>
                    <div className="w-px h-3 bg-[#C5A059]/30 mx-2" />
                    <button onClick={() => bulkAction('ARCHIVE')} className="text-[9px] uppercase font-bold text-amber-500 hover:underline">Archivovat</button>
                    <button onClick={() => bulkAction('DELETE')} className="text-[9px] uppercase font-bold text-red-500 hover:underline">Smazat</button>
                    <button onClick={() => setSelectedBulkIds([])} className="ml-2 text-[#444] hover:text-white"><X size={10}/></button>
                  </div>
                ) : (
                  <>
                    <select value={fileSortBy} onChange={(e) => setFileSortBy(e.target.value as any)} className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-mono text-[#666] outline-none hover:border-[#444]">
                      <option value="ORDER">Řadit: Hierarchie LG13</option>
                      <option value="date">Řadit: Datum</option>
                      <option value="name">Řadit: Název</option>
                      <option value="type">Řadit: Typ</option>
                      <option value="batch">Řadit: Balík (ZIP)</option>
                    </select>
                    <div className="h-4 w-px bg-[#222] mx-2" />
                    <button onClick={() => setShowArchived(!showArchived)} className={cn("text-[10px] uppercase font-black px-3 py-1 border transition-all flex items-center gap-2", showArchived ? "bg-amber-600/10 border-amber-600 text-amber-600" : "border-[#222] text-[#444]")}>
                      <FolderArchive size={12}/> {showArchived ? 'Active Mode' : 'Archiv Mode'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-4 items-center">
              {uploadedFiles.length > 0 && (
                <select 
                  value={uploadBatchId || ''} 
                  onChange={(e) => setUploadBatchId(e.target.value === '' ? null : e.target.value)}
                  className="bg-[#111] border border-[#222] px-3 py-1 text-[10px] uppercase font-mono text-[#666] outline-none hover:border-[#444]"
                >
                  <option value="">Nový Balík</option>
                  {Array.from(new Set(uploadedFiles.filter(f => f.batchId).map(f => f.batchId))).map(bid => (
                    <option key={bid} value={bid}>Přidat k {bid}</option>
                  ))}
                </select>
              )}
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#666] hover:text-white transition-colors"><Upload size={12} /> Nahrát</button>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple className="hidden" />
              <button 
                onClick={() => {
                  setShowDriveModal(true);
                  if (driveToken) {
                    fetchDriveFiles('root', driveToken);
                  }
                }} 
                className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#C5A059] hover:text-white transition-colors"
                title="Importovat z Disku Google"
              >
                <Cloud size={12} /> Disk Google
              </button>
            </div>
          </div>

          {/* INTELIGENTNÍ PANEL PRE-INDEXACE VERZÍ */}
          <div className="bg-[#0b0b0b] border border-[#222] p-4 mb-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6 rounded-xs">
            <div className="space-y-1 max-w-lg">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <h4 className="text-[10px] font-black uppercase text-white tracking-widest">AUTONOMNÍ PODPŮRNÁ INDEXACE SOUBORŮ (GOOGLE DRIVE INDEXER_V2)</h4>
              </div>
              <p className="text-[9px] text-[#555] leading-relaxed font-mono">
                Při importu složek z Disku Google (např. <span className="text-[#C5A059] font-mono">Google_LG13_Lex /*</span>) se podsložky jako F18, F16 atp. automaticky roztřídí a indexují v pozadí. 
                Algoritmus extrahuje právní souvislosti, eliminaci chyb, provazby a podklady pro vertikální srovnání ještě před zahájením hlavního Juris-Auditu.
              </p>
              {activeAutoImports.length > 0 && (
                <div className="mt-3 bg-amber-950/20 border border-amber-500/20 p-3 rounded">
                  <div className="font-mono text-[8px] uppercase tracking-wider text-amber-500 flex items-center gap-1.5 font-black mb-1.5">
                    <Loader2 size={10} className="animate-spin text-amber-400" /> AUTONOMNÍ POZAĎOVÉ STAHU_INDEXOVÁNÍ VERZÍ (F****)
                  </div>
                  <div className="space-y-1">
                    {activeAutoImports.map(a => (
                      <div key={a.id} className="flex flex-col sm:flex-row sm:justify-between font-mono text-[8px] gap-1">
                        <span className="text-white">Složka: <span className="text-[#C5A059] font-black">{a.name}</span></span>
                        <span className="text-amber-500/85 animate-pulse text-right">{a.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-4 bg-[#111] p-3 border border-[#1a1a1a] rounded-sm shrink-0">
              <div className="flex flex-col">
                <span className="text-[8px] uppercase tracking-wider text-[#666] font-mono">Pre-indexace pozadí:</span>
                <button 
                  onClick={() => {
                    if (quotaCountdown > 0) {
                      setQuotaCountdown(0);
                      setIsAutoIndexingEnabled(true);
                    } else {
                      setIsAutoIndexingEnabled(!isAutoIndexingEnabled);
                    }
                  }}
                  className={cn(
                    "mt-1 px-3 py-1 text-[9px] font-black uppercase tracking-widest border transition-all cursor-pointer",
                    isAutoIndexingEnabled ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : 
                    quotaCountdown > 0 ? "bg-amber-500/10 border-amber-500 text-amber-500 animate-pulse" : "bg-red-500/10 border-red-500 text-red-500"
                  )}
                >
                  {isAutoIndexingEnabled ? '● AKTIVNÍ' : 
                   quotaCountdown > 0 ? `⌛ LIMIT-OBNOVA (${quotaCountdown}s)` : '○ POZASTAVENÁ'}
                </button>
              </div>

              <div className="h-8 w-px bg-[#222]" />

              <div className="grid grid-cols-4 gap-3 text-center min-w-[164px]">
                <div>
                  <div className="text-[11px] font-mono font-black text-[#888]">{uploadedFiles.filter(f => f.caseId === currentCaseId).length}</div>
                  <div className="text-[7px] text-[#444] uppercase font-mono">SPIS</div>
                </div>
                <div>
                  <div className="text-[11px] font-mono font-black text-amber-500">{uploadedFiles.filter(f => f.caseId === currentCaseId && f.indexStatus === 'IDLE').length}</div>
                  <div className="text-[7px] text-[#444] uppercase font-mono">ČEKÁ</div>
                </div>
                <div>
                  <div className="text-[11px] font-mono font-black text-yellow-500 animate-pulse">{uploadedFiles.filter(f => f.caseId === currentCaseId && f.indexStatus === 'INDEXING').length}</div>
                  <div className="text-[7px] text-[#444] uppercase font-mono">PRÁCE</div>
                </div>
                <div>
                  <div className="text-[11px] font-mono font-black text-[#C5A059]">{uploadedFiles.filter(f => f.caseId === currentCaseId && f.indexStatus === 'DONE').length}</div>
                  <div className="text-[7px] text-[#444] uppercase font-mono">HOT_INS</div>
                </div>
              </div>

              <div className="h-8 w-px bg-[#222]" />

              <div className="flex gap-1.5">
                <button 
                  onClick={() => {
                    setConfirmDialog({
                      title: 'RESTARTOVAT INDEXY',
                      message: 'Chcete opravdu restartovat stav u všech souborů aktivního spisu? Znovu se spustí proces indexování.',
                      onConfirm: () => {
                        setUploadedFiles(prev => prev.map(f => f.caseId === currentCaseId ? { ...f, indexStatus: 'IDLE' } : f));
                        setIsAutoIndexingEnabled(true);
                      }
                    });
                  }}
                  className="px-2 py-1.5 border border-[#222] text-[#555] hover:text-white hover:border-[#444] font-mono text-[8px] uppercase transition-all"
                  title="Obnovit stav u všech souborů na čekající"
                >
                  Restart
                </button>
                <button 
                  onClick={() => {
                    setIsAutoIndexingEnabled(true);
                    setUploadedFiles(prev => prev.map(f => f.caseId === currentCaseId && f.indexStatus === 'ERROR' ? { ...f, indexStatus: 'IDLE' } : f));
                  }}
                  className="px-2.5 py-1.5 bg-[#C5A059]/10 border border-[#C5A059]/30 text-[#C5A059] hover:bg-[#C5A059] hover:text-black font-mono text-[8px] uppercase font-black transition-all"
                  title="Spustit pre-indexaci pro všechny čekající soubory okamžitě"
                >
                  ⚡ EXCELOVAT
                </button>
              </div>
            </div>
          </div>

          {/* STRATEGICKÝ GRAF RIZIK VERZÍ (RECHARTS) */}
          {selectionMode === 'VERSIONS' && (
            <div className="bg-[#0b0b0b] border border-[#222] p-6 mb-8 rounded-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1a1a1a] pb-4 mb-6">
                <div className="space-y-1">
                  <h3 className="text-[10px] font-black uppercase text-white tracking-widest flex items-center gap-2">
                    <Gauge size={14} className="text-[#C5A059]" /> Srovnávací Trajektorie Integrity a Rizik (Recharts Core Engine)
                  </h3>
                  <p className="text-[9px] font-mono text-[#555]">
                    Vizualizace posunu klíčových metrik (Integrita argumentů %, Celková síla %, Procesní úspěšnost %, Rizika) napříč verzemi spisu.
                  </p>
                </div>
                <div className="flex gap-2 text-[9px] font-mono">
                  <span className="text-[#444]">Legenda:</span>
                  <span className="text-[#C5A059] font-bold">● Integrita</span>
                  <span className="text-[#22c55e] font-bold">● Právní Síla</span>
                  <span className="text-[#3b82f6] font-bold">● Úspěšnost</span>
                  <span className="text-[#ef4444] font-bold">▲ Rizikovost</span>
                </div>
              </div>
              
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={getRechartsData()}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorIntegrita" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C5A059" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#C5A059" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorSila" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#111" />
                    <XAxis 
                      dataKey="name" 
                      stroke="#444" 
                      fontSize={9}
                      tickLine={false}
                    />
                    <YAxis 
                      stroke="#444" 
                      fontSize={9}
                      tickLine={false}
                      domain={[0, 100]}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#050505', borderColor: '#222', fontSize: '10px', fontFamily: 'monospace' }}
                      itemStyle={{ color: '#CCC' }}
                    />
                    <Area type="monotone" dataKey="Integrita" stroke="#C5A059" strokeWidth={2} fillOpacity={1} fill="url(#colorIntegrita)" name="Integrita %" />
                    <Area type="monotone" dataKey="Sila" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorSila)" name="Právní síla %" />
                    <Line type="monotone" dataKey="Uspesnost" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Pravděpodobnost %" />
                    <Line type="monotone" dataKey="Riziko" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} name="Složitost/Rizika %" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex flex-wrap justify-between items-center text-[8px] font-mono text-[#444] border-t border-[#1a1a1a] pt-3">
                <span>ZDROJ: JURISREVIEW ANALYTICAL ENGINE V_1.9</span>
                <span>ZÁZNAMY SE AKTUALIZUJÍ AUTOMATICKY PO KAŽDÉ ÚLOZE</span>
              </div>
            </div>
          )}

          <div className={cn(selectionMode === 'VERSIONS' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "grid grid-cols-2 lg:grid-cols-6 gap-4")}>
            {selectionMode === 'VERSIONS' ? (
              Array.from(new Set(uploadedFiles.filter(f => f.caseId === currentCaseId).map(f => f.version))).sort().reverse().map(ver => {
                const isSelected = compareVersionIds.includes(ver);
                const filesInVer = uploadedFiles.filter(f => f.version === ver && f.caseId === currentCaseId);
                return (
                  <div 
                    key={ver}
                    onClick={() => {
                      if (isSelected) setCompareVersionIds(prev => prev.filter(id => id !== ver));
                      else if (compareVersionIds.length < 2) setCompareVersionIds(prev => [...prev, ver]);
                    }}
                    className={cn(
                      "group relative border-2 p-6 transition-all cursor-pointer overflow-hidden",
                      isSelected ? "border-[#C5A059] bg-[#C5A059]/5 shadow-[0_0_30px_rgba(197,160,89,0.1)]" : "border-[#111] hover:border-[#222] bg-[#0c0c0c]"
                    )}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className={cn("text-sm font-black uppercase tracking-tighter block", isSelected ? "text-[#C5A059]" : "text-white")}>{ver}</span>
                        <div className="text-[8px] text-[#444] font-mono mt-1">ID: {ver.replace(/[^a-zA-Z0-9]/g, '_')}</div>
                      </div>
                      {isSelected ? <ShieldCheck size={18} className="text-[#C5A059]" /> : <Layers size={18} className="text-[#222]" />}
                    </div>
                    
                    <div className="space-y-1 mb-4">
                      {filesInVer.slice(0, 3).map(f => (
                        <div key={f.id} className="text-[9px] text-[#666] truncate flex items-center gap-2">
                           <div className="w-1 h-1 rounded-full bg-[#333]" /> {f.name}
                        </div>
                      ))}
                      {filesInVer.length > 3 && <div className="text-[8px] text-[#333] italic">+ {filesInVer.length - 3} dalších příloh</div>}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-[#222]">
                      <div className="text-[9px] font-black text-white">{filesInVer.length} SOUBORŮ</div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); assignVersionToCase(ver); }}
                        className="text-[8px] font-black bg-[#222] px-2 py-1 text-[#666] hover:text-white hover:bg-[#333] transition-all uppercase"
                      >
                        Přiřadit ke spisu
                      </button>
                      {isSelected && (
                        <div className="text-[8px] font-black uppercase text-[#C5A059]">
                          {compareVersionIds.indexOf(ver) === 0 ? 'SOURCE (ZÁKLAD)' : 'TARGET (PŘÍRASTK)'}
                        </div>
                      )}
                    </div>
                    {isSelected && <div className="absolute top-0 right-0 w-2 h-full bg-[#C5A059]" />}
                  </div>
                )
              })
            ) : (
              filteredFiles.map((file) => {
              const isSelected = selectedFileIds.includes(file.id);
              const isSupport = supportFileIds.includes(file.id);
              const isBulk = selectedBulkIds.includes(file.id);
              return (
                <div key={file.id} className="group relative">
                <div 
                  className={cn(
                    "border p-3 transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between min-h-[90px]",
                    isBulk ? "border-white bg-white/10" : 
                    isSelected ? "border-[#C5A059] bg-[#C5A059]/10 shadow-[0_0_15px_rgba(197,160,89,0.1)]" : 
                    isSupport ? "border-emerald-600 bg-emerald-950/20" : 
                    getFileColor(file)
                  )}
                >
                  <div className="text-[8px] font-mono text-[#666] uppercase mb-1 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                       {file.batchId && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: `hsl(${file.batchId.split('').reduce((a,b)=>a+b.charCodeAt(0),0)%360}, 70%, 50%)` }} title={`Batch: ${file.batchId}`} />}
                       <span>{file.batchId || file.id}</span>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={isBulk} 
                      onChange={() => toggleFileSelection(file.id, 'BULK')}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-[#C5A059] h-3 w-3 cursor-pointer"
                    />
                  </div>
                  <div 
                    onClick={() => !file.isArchived && toggleFileSelection(file.id, 'SELECT')}
                    onContextMenu={(e) => { e.preventDefault(); toggleFileSelection(file.id, 'SUPPORT'); }}
                    className={cn("text-[10px] font-black leading-tight truncate mb-2 flex items-center gap-2", isSelected ? "text-white" : isSupport ? "text-emerald-400" : "text-[#999]")}
                  >
                    {isSelected && <Sparkles size={10} className="text-[#C5A059] shrink-0 animate-pulse" />}
                    {file.name}
                    <div className="ml-auto flex gap-1">
                      {file.content && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" title="Obsah načten" />}
                      {file.indexStatus === 'INDEXING' && <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" title="Probíhá indexace..." />}
                      {file.indexStatus === 'DONE' && <div className="w-1.5 h-1.5 rounded-full bg-[#C5A059]" title="Indexováno se znalostí okolí" />}
                      {file.indexStatus === 'ERROR' && <div className="w-1.5 h-1.5 rounded-full bg-red-500" title="Chyba indexace" />}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    {file.category === 'SKILLS' ? (
                      <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 text-[7px] font-mono rounded border border-amber-500/30 uppercase font-black" title="Metodický skill připojený k analýze">SKILL METODIKA</span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-[#1a1a1a] text-[#888] text-[7px] font-mono rounded border border-[#222] uppercase">{file.category || file.type}</span>
                    )}
                    <div className="flex gap-1 items-center">
                      {file.type === 'PDF' && <button onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }} className="p-1 hover:text-[#C5A059] transition-colors"><Eye size={8}/></button>}
                      {isSelected && <span className="text-[7px] font-black text-[#C5A059]">OBJ</span>}
                          {isSupport && <span className="text-[7px] font-black text-emerald-500">REF</span>}
                        </div>
                      </div>
                    </div>
                    <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 z-10">
                      {file.isArchived ? (
                        <button onClick={(e) => { e.stopPropagation(); restoreFile(file.id); }} className="bg-[#111] border border-[#222] p-1.5 rounded-full hover:bg-emerald-900 text-emerald-500"><RotateCcw size={10}/></button>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); archiveFile(file.id); }} className="bg-[#111] border border-[#222] p-1.5 rounded-full hover:bg-amber-900 text-amber-500"><FolderArchive size={10}/></button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); deleteFile(file.id); }} className="bg-[#111] border border-[#222] p-1.5 rounded-full hover:bg-red-900 text-red-500"><Trash2 size={10}/></button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#444] font-black flex items-center gap-2">
              <ListFilter size={14}/> (00a) KONFIGURACE_AUDITNÍCH_PILÍŘŮ
            </h2>
            <div className="flex gap-2">
              <button 
                onClick={() => toggleAllPillars(true)}
                className="text-[9px] font-black uppercase text-[#C5A059] border border-[#C5A059]/20 px-3 py-1 hover:bg-[#C5A059]/10 transition-all"
              >
                Všechny Pilíře
              </button>
              <button 
                onClick={() => toggleAllPillars(false)}
                className="text-[9px] font-black uppercase text-[#666] border border-[#222] px-3 py-1 hover:text-white transition-all"
              >
                Vyčistit
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {auditPillars.map((pillar) => {
              const isSelected = selectedPillarIds.includes(pillar.id);
              return (
                <div key={pillar.id} onClick={() => togglePillarSelection(pillar.id)} className={cn("border p-4 transition-all cursor-pointer relative group", isSelected ? "border-[#C5A059] bg-[#C5A059]/5" : "border-[#151515] bg-[#0A0A0A] opacity-50 grayscale hover:opacity-100")}>
                  <div className="flex items-start justify-between mb-2">
                    <div className={cn("text-[9px] font-black uppercase tracking-widest flex items-center gap-2", isSelected ? "text-[#C5A059]" : "text-[#555]")}>
                      {pillar.icon} {pillar.name}
                    </div>
                    <div className={cn("h-3 w-3 border flex items-center justify-center transition-colors", isSelected ? "border-[#C5A059] bg-[#C5A059]" : "border-[#333]")}>
                      {isSelected && <Check size={8} className="text-black" />}
                    </div>
                  </div>
                  <p className={cn("text-[9px] font-mono leading-relaxed", isSelected ? "text-[#888]" : "text-[#333]")}>{pillar.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
             <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#444] font-black flex items-center gap-2">
              <FileDown size={14}/> (01a) POKYNY_K_REDAKCI_A_DRAFTŮM
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[8px] uppercase font-black text-[#555] tracking-widest pl-1">Všeobecný kontext / Git Repo</label>
              <input 
                type="text"
                value={gitContext}
                onChange={(e) => setGitContext(e.target.value)}
                placeholder="https://github.com/..."
                className="w-full bg-[#111] border border-[#222] px-4 py-2 text-[10px] font-mono text-[#C5A059] outline-none focus:border-[#C5A059]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[8px] uppercase font-black text-[#555] tracking-widest pl-1">Specifické Auditní Poznámky</label>
              <textarea 
                value={notes} 
                onChange={(e) => setNotes(e.target.value)} 
                placeholder="Zadejte doplňující poznámky pro AI (např. 'Zohledni judikát o péči z 2024')..."
                className="w-full bg-[#151515] border border-[#222] p-4 text-xs font-mono text-[#777] outline-none focus:border-[#C5A059] h-24 custom-scrollbar"
              />
            </div>
          </div>
        </section>

        <section className="mb-12">
          <div className="border-l-2 border-[#222] pl-8 py-6 flex flex-col lg:flex-row justify-between items-start gap-12 bg-gradient-to-r from-[#0A0A0A] to-transparent">
            <div className="flex-1">
              <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#444] font-black mb-6">DYNAMICKÝ_PLÁN_AUDITU_PRO_{currentVersion}</h2>
              <div className="flex flex-wrap gap-8">
                <div><div className="text-[9px] text-[#444] font-mono uppercase mb-2">Kontext</div><div className="text-lg font-black text-[#999]">{selectedFileIds.length} SOUBORŮ</div></div>
                <div><div className="text-[9px] text-[#444] font-mono uppercase mb-2">Reference</div><div className="text-lg font-black text-emerald-900">{supportFileIds.length} SOUBORŮ</div></div>
                <div><div className="text-[9px] text-[#444] font-mono uppercase mb-2">Auditní Šíře</div><div className="text-lg font-black text-[#C5A059]">{selectedPillarIds.length} METRIK</div></div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex gap-2 bg-[#151515] border border-[#222] p-1">
                <button 
                  onClick={() => setQueueStrategy('COMBINE')} 
                  className={cn("px-4 py-2 text-[9px] uppercase font-black transition-all", queueStrategy === 'COMBINE' ? "bg-[#C5A059] text-black" : "text-[#666] hover:text-white")}
                  title="Všechny vybrané soubory v jedné analýze"
                >
                  Kombinovat
                </button>
                <button 
                  onClick={() => setQueueStrategy('PER_FILE')} 
                  className={cn("px-4 py-2 text-[9px] uppercase font-black transition-all", queueStrategy === 'PER_FILE' ? "bg-[#C5A059] text-black" : "text-[#666] hover:text-white")}
                  title="Každý soubor jako samostatná úloha"
                >
                  Per Soubor
                </button>
                <button 
                  onClick={() => setQueueStrategy('CROSS')} 
                  className={cn("px-4 py-2 text-[9px] uppercase font-black transition-all", queueStrategy === 'CROSS' ? "bg-[#C5A059] text-black" : "text-[#666] hover:text-white")}
                  title="Každý soubor x každý pilíř = samostatná úloha"
                >
                  Matrix
                </button>
              </div>
              <button 
                onClick={addToQueue} 
                disabled={selectionMode === 'FILES' ? selectedFileIds.length === 0 : compareVersionIds.length === 0} 
                className={cn("px-12 py-5 text-[12px] font-black uppercase tracking-[0.4em] border transition-all group relative overflow-hidden", (selectionMode === 'FILES' ? selectedFileIds.length === 0 : compareVersionIds.length === 0) ? "border-[#222] text-[#333] cursor-not-allowed" : "border-[#C5A059] text-[#C5A059] hover:bg-[#C5A059] hover:text-black")}
              >
                <span className="relative z-10 flex items-center gap-3">
                  {uploadedFiles.some(f => f.indexStatus === 'INDEXING') && <Loader2 size={16} className="animate-spin" />}
                  {uploadedFiles.some(f => f.indexStatus === 'INDEXING') ? 'Probíhá Indexace Balíku...' : 'Zahájit Auditní Úlohu'}
                </span>
                {uploadedFiles.some(f => f.indexStatus === 'INDEXING') && (
                  <motion.div 
                    initial={{ width: 0 }} 
                    animate={{ width: '100%' }} 
                    transition={{ duration: 10, repeat: Infinity }}
                    className="absolute bottom-0 left-0 h-1 bg-[#C5A059]/20"
                  />
                )}
              </button>
            </div>
          </div>
        </section>

        {auditQueue.length > 0 && (
          <section className="mb-20">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#444] font-black flex items-center gap-2">
                <RefreshCcw size={14} className={cn(isQueueRunning && "animate-spin text-[#C5A059]")}/> 
                (00b) FRONTA_AUDITNÍCH_ÚLOH 
                {isQueueRunning && <span className="text-[#C5A059] ml-2 animate-pulse font-mono">[PROBÍHÁ SEKVENČNÍ ZPRACOVÁNÍ]</span>}
              </h2>
              <div className="flex gap-4">
                <div className="flex bg-[#111] border border-[#222] p-1 gap-1">
                  {isQueueRunning ? (
                    <button 
                      onClick={stopQueue} 
                      className="px-3 py-1 text-[9px] uppercase font-black text-red-500 hover:bg-red-500/10 transition-all flex items-center gap-2"
                    >
                      <X size={10}/> Zastavit
                    </button>
                  ) : (
                    <button 
                      onClick={clearQueue} 
                      disabled={auditQueue.length === 0}
                      className="px-3 py-1 text-[9px] uppercase font-black text-[#555] hover:text-red-500 transition-all disabled:opacity-30 flex items-center gap-2"
                    >
                      <Trash2 size={10}/> Vymazat frontu
                    </button>
                  )}
                   <button 
                    onClick={() => downloadAllResults(true, 'ZIP')} 
                    disabled={auditQueue.filter(t => t.status === 'done' && t.timestamp >= new Date().setHours(0,0,0,0)).length === 0}
                    className="px-3 py-1 text-[9px] uppercase font-black text-emerald-500 hover:bg-emerald-500/10 transition-all disabled:opacity-30 flex items-center gap-2"
                  >
                    <Download size={10}/> Dnešní (ZIP)
                  </button>
                  <button 
                    onClick={() => downloadAllResults(true, 'PDF')} 
                    disabled={auditQueue.filter(t => t.status === 'done' && t.timestamp >= new Date().setHours(0,0,0,0)).length === 0}
                    className="px-3 py-1 text-[9px] uppercase font-black text-emerald-400 hover:bg-emerald-400/10 transition-all disabled:opacity-30 flex items-center gap-2"
                  >
                    <FileText size={10}/> Dnešní (PDF)
                  </button>
                  <button 
                    onClick={() => downloadAllResults(false, 'ZIP')} 
                    disabled={auditQueue.filter(t => t.status === 'done').length === 0}
                    className="px-3 py-1 text-[9px] uppercase font-black text-blue-500 hover:bg-blue-500/10 transition-all disabled:opacity-30 flex items-center gap-2"
                  >
                    <Archive size={10}/> Vše (ZIP)
                  </button>
                  <button 
                    onClick={() => downloadAllResults(false, 'PDF')} 
                    disabled={auditQueue.filter(t => t.status === 'done').length === 0}
                    className="px-3 py-1 text-[9px] uppercase font-black text-blue-400 hover:bg-blue-400/10 transition-all disabled:opacity-30 flex items-center gap-2"
                  >
                    <FileDown size={10}/> Vše (PDF)
                  </button>
                </div>
                <button 
                  onClick={executeAllQueue} 
                  disabled={isQueueRunning || isReviewing || auditQueue.every(t => t.status === 'done')} 
                  className="px-4 py-2 border border-[#C5A059] text-[10px] uppercase font-black text-[#C5A059] hover:bg-[#C5A059] hover:text-black transition-all disabled:opacity-30 flex items-center gap-2"
                >
                  {isQueueRunning ? <Loader2 size={12} className="animate-spin"/> : <RefreshCcw size={12}/>}
                  Spustit Všechny Úlohy
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              {auditQueue.map((item) => (
                <div key={item.id} onClick={() => item.status === 'done' && setActiveQueueId(item.id)} className={cn("flex flex-col md:flex-row md:items-center justify-between border p-4 group transition-all relative overflow-hidden", item.status === 'done' ? "bg-[#0A0A0A] border-[#222] cursor-pointer hover:border-[#444]" : "bg-[#050505] border-[#111]", activeQueueId === item.id && "border-[#C5A059] bg-[#C5A059]/5", currentProcessingId === item.id && "border-blue-500 bg-blue-500/5")}>
                   {(item.status === 'processing' || currentProcessingId === item.id) && <motion.div initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="absolute bottom-0 left-0 h-[1px] w-full bg-[#C5A059] opacity-50" />}
                   <div className="flex items-center gap-6 overflow-hidden">
                    <div className={cn("text-[10px] font-mono", item.status === 'processing' ? "text-[#C5A059]" : "text-[#333] opacity-50")}>{item.id}</div>
                    <div className="flex flex-col gap-1">
                      <div className={cn("text-[10px] font-black tracking-widest uppercase", item.status === 'done' ? "text-[#888]" : "text-[#666]")}>
                        {item.title ? `${item.title} (${item.version})` : item.version} // {item.files[0]} {item.files.length > 1 ? `+ ${item.files.length - 1} další` : ''}
                      </div>
                      <div className="text-[8px] font-mono text-[#333] truncate italic opacity-50">{item.pillars.join(' • ')}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-4 md:mt-0">
                    <div className={cn("text-[9px] font-bold px-2 py-1 uppercase flex items-center gap-2", 
                      item.status === 'pending' ? "text-[#444] bg-[#222]/20" : 
                      item.status === 'processing' ? "text-[#C5A059] bg-[#C5A059]/10 animate-pulse" : 
                      "text-emerald-500 bg-emerald-500/10"
                    )}>
                      {item.status === 'processing' && <Loader2 size={8} className="animate-spin"/>}
                      {item.status}
                    </div>
                    <div className="flex gap-2">
                      {driveToken && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); exportAuditToGoogleTasks(item); }} 
                          className="p-2 border border-[#C5A059]/30 text-[#C5A059] hover:bg-[#C5A059]/10 transition-all" 
                          title="Exportovat do Google Tasks"
                        >
                          <Cloud size={14}/>
                        </button>
                      )}
                       {item.status === 'pending' && !isQueueRunning && <button onClick={(e) => { e.stopPropagation(); handleReview(item.id); }} className="p-2 border border-[#C5A059]/40 text-[#C5A059] hover:bg-[#C5A059] hover:text-black transition-all" title="Spustit úlohu"><Send size={14}/></button>}
                       {item.status === 'done' && <button onClick={(e) => { e.stopPropagation(); downloadReport(item.id); }} className="p-2 border border-[#222] text-[#444] hover:text-white transition-all"><Download size={14}/></button>}
                       <button onClick={(e) => { e.stopPropagation(); removeFromQueue(item.id); if (activeQueueId === item.id) setActiveQueueId(null); }} className="p-2 border border-[#222] text-red-950 hover:text-red-500 transition-all"><Trash2 size={14}/></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* (00c) SYSTÉMOVÝ INTEGRÁTOR ÚLOH (GOOGLE TASKS ENGINE) */}
        <section className="mb-20 bg-[#0a0a0a] border border-[#222] p-8 shadow-2xl rounded-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#111] pb-6 mb-8">
            <div className="space-y-1">
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#C5A059] font-black flex items-center gap-2">
                <Database size={14} className={cn(isFetchingTasks && "animate-spin text-[#C5A059]")}/>
                (00c) SYSTÉMOVÝ INTEGRÁTOR ÚLOH (GOOGLE WORKSPACE TASKS ENGINE)
              </h2>
              <p className="text-[9px] font-mono text-[#555]">
                Systémová obousměrná komunikace. Načítání a správa požadavků na forenzní analýzy (§LG13§) přímo z vašeho Google Kalendáře / Google Tasks.
              </p>
            </div>
            
            {driveToken && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={syncGoogleTasksNow}
                  disabled={isFetchingTasks}
                  className="px-3 py-1.5 border border-[#222] hover:border-[#C5A059] text-[9px] font-mono uppercase text-[#CCC] hover:text-[#C5A059] transition-all flex items-center gap-2"
                >
                  <RefreshCcw size={10} className={cn(isFetchingTasks && "animate-spin")} />
                  {isFetchingTasks ? 'Synchronizace API...' : 'Synchronizovat ihned'}
                </button>
              </div>
            )}
          </div>

          {!driveToken ? (
            <div className="p-8 border border-dashed border-[#222] text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#C5A059]/5 border border-[#C5A059]/10 flex items-center justify-center mx-auto text-[#C5A059]">
                <Cloud size={20} className="opacity-40" />
              </div>
              <p className="text-[10px] font-mono text-[#555] max-w-lg mx-auto leading-relaxed">
                Google Tasks integrátor není aktivní. Přihlaste se pomocí Google účtu (tlačítkem v sekci disků nebo v záhlaví), čímž dojde k vytvoření delegovaného listu <span className="text-[#C5A059] font-bold">§LG13§ Juris-Audits</span> a otevření API brány.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {successTaskMessage && (
                <div className="p-3 bg-emerald-950/10 border border-emerald-900/40 text-emerald-400 text-[10px] font-mono uppercase tracking-wider flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                  <CheckCircle2 size={12} /> {successTaskMessage}
                </div>
              )}

              {tasksError && (
                <div className="p-3 bg-red-950/10 border border-red-900/40 text-red-400 text-[10px] font-mono uppercase tracking-wider flex items-center gap-2">
                  <AlertCircle size={12} /> CHYBA INTEGRACE: {tasksError}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* COLUMN 1: NEW TASK CREATION & CONFIGURATION */}
                <div className="lg:col-span-4 space-y-6 lg:border-r lg:border-[#111] lg:pr-8">
                  <div className="space-y-2">
                    <h3 className="text-[10px] font-black uppercase text-white tracking-widest">
                      Rychlý zápis do Google Tasks
                    </h3>
                    <p className="text-[9px] font-mono text-[#444] leading-relaxed">
                      Zapište nový úkol přímo do vašeho synchronizovaného listu v Google Tasks. Úkoly s prefixem <code className="text-[#C5A059]">AUDIT: [Version]</code> budou moci být spuštěny jako forenzní úkony.
                    </p>
                  </div>

                  <form 
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      const title = formData.get('taskTitle') as string;
                      const notes = formData.get('taskNotes') as string;
                      if (!title) return;
                      await createGoogleTaskQuick(title, notes);
                      e.currentTarget.reset();
                    }}
                    className="space-y-3"
                  >
                    <div>
                      <input 
                        name="taskTitle"
                        required
                        type="text" 
                        placeholder="Např: AUDIT: V_UPGRADED_F2" 
                        className="w-full bg-black border border-[#222] p-3 text-[10px] font-mono outline-none text-white focus:border-[#C5A059]"
                      />
                    </div>
                    <div>
                      <textarea 
                        name="taskNotes"
                        placeholder="Poznámky k analýze, instrukce (nepovinné)..." 
                        className="w-full bg-black border border-[#222] p-3 text-[10px] font-mono outline-none text-white focus:border-[#C5A059] h-20 custom-scrollbar"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isCreatingTask}
                      className="w-full px-4 py-2.5 bg-[#C5A059] hover:bg-white text-black text-[9px] uppercase font-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isCreatingTask ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                      Vytvořit Google Task
                    </button>
                  </form>

                  <div className="p-4 bg-[#070707] border border-[#1a1a1a] space-y-2">
                    <div className="text-[8px] font-black uppercase text-[#555]">PROPOJENÝ SEZNAM ÚKOLŮ</div>
                    <div className="font-mono text-[9px] text-[#CCC] truncate flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      ID: {googleTasksListId || 'Načítání...'}
                    </div>
                    <div className="text-[8px] font-mono text-[#444]">
                      Název listu: <strong>§LG13§ Juris-Audits</strong>
                    </div>
                  </div>
                </div>

                {/* COLUMN 2: ACTIVE AND EXTERNAL TASKS DISCOVERY TABLE */}
                <div className="lg:col-span-8 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase text-white tracking-widest">
                      Spárované a externě přihlášené úkoly v listu
                    </h3>
                    <span className="text-[9px] font-mono text-[#555]">
                      Celkem: {googleTasks.length} záznamů
                    </span>
                  </div>

                  {googleTasks.length === 0 ? (
                    <div className="py-12 text-center border border-[#111] bg-black/40">
                      <p className="text-[10px] font-mono text-[#333]">V Google Tasks listu nebyly nalezeny žádné úkoly.</p>
                    </div>
                  ) : (
                    <div className="border border-[#222] divide-y divide-[#151515] bg-black/50 overflow-hidden rounded-sm max-h-96 overflow-y-auto custom-scrollbar">
                      {googleTasks.map((task) => {
                        const isAuditTask = task.title.toUpperCase().includes('AUDIT');
                        const isCompleted = task.status === 'completed';

                        return (
                          <div key={task.id} className={cn("p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:bg-white/[0.01]", isCompleted && "opacity-40")}>
                            <div className="space-y-1.5 max-w-xl">
                              <div className="flex items-center gap-2">
                                <span className={cn("text-[9px] font-mono px-1.5 py-0.5 font-bold uppercase shrink-0", 
                                  isAuditTask ? "bg-[#C5A059]/10 text-[#C5A059]" : "bg-[#222] text-[#666]"
                                )}>
                                  {isAuditTask ? 'AUDIT_REQUEST' : 'GENERAL_TASK'}
                                </span>
                                <h4 className={cn("text-[11px] font-bold text-white tracking-wide uppercase", isCompleted && "line-through text-gray-600")}>
                                  {task.title}
                                </h4>
                              </div>
                              {task.notes && (
                                <p className="text-[9px] font-mono text-[#666] leading-relaxed line-clamp-2 italic">
                                  {task.notes}
                                </p>
                              )}
                              <div className="flex items-center gap-4 text-[8px] font-mono text-[#333]">
                                <span>Upraveno: {new Date(task.updated).toLocaleString()}</span>
                                {isCompleted && <span className="text-emerald-500 font-bold">● Dokončeno</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {/* If task is an external request start with AUDIT:, let them run the process */}
                              {isAuditTask && !isCompleted && (
                                <button
                                  onClick={() => registerTaskFromGoogleToQueue(task)}
                                  className="px-3 py-1.5 bg-[#C5A059]/10 border border-[#C5A059]/40 text-[#C5A059] hover:bg-[#C5A059] hover:text-black text-[9px] uppercase font-black transition-all flex items-center gap-1.5"
                                  title="Importovat a zaregistrovat do auditní fronty"
                                >
                                  <Send size={10} />
                                  Načíst do fronty
                                </button>
                              )}

                              {!isCompleted && (
                                <button
                                  onClick={() => completeGoogleTaskNow(task.id)}
                                  className="p-1 px-2 border border-[#222] text-gray-400 hover:text-white hover:border-[#444] text-[9px] font-mono uppercase transition-all"
                                  title="Označit za splněný"
                                >
                                  splnit
                                </button>
                              )}

                              <button
                                onClick={() => deleteGoogleTaskNow(task.id)}
                                className="p-1.5 border border-[#222] text-red-900/60 hover:text-red-500 hover:border-red-500/20 transition-all"
                                title="Smazat z Google Tasks"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* REVOLUČNÍ STRATEGICKÉ REŽIMY S ANALÝZOU DO HLOUBKY */}
        <section className="mb-12 bg-[#0a0a0a] border border-[#222] p-8 shadow-2xl rounded-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#181818]">
            <div>
              <h3 className="text-xs uppercase tracking-[0.2em] font-black text-[#C5A059] flex items-center gap-2">
                <Gauge size={14} className="text-[#C5A059]" /> VOLBA ANALYTICKÉHO / TVŮRČÍHO REŽIMU SPISU
              </h3>
              <p className="text-[9px] font-mono text-[#555] mt-1">SÍLA EXCELENCE JURIS-AUDIT PROCESORU PRO VERZE SOUBORŮ</p>
            </div>
            <div className="text-[9px] font-mono text-[#888] bg-[#111] px-3 py-1.5 border border-[#222]">
               AKTIVNÍ PROCESOR: <span className="text-amber-500 font-black">{
                 appMode === 'AUDIT' ? '⚡ FORENZNÍ JURIS-AUDIT' :
                 appMode === 'COMPOSE' ? '✍️ KO-EDITAČNÍ DRAFTING' :
                 appMode === 'VERTICAL' ? '⏳ CHRONO-VERTIKÁLNÍ EVOLUCE' :
                 appMode === 'DASHBOARD' ? '📊 ANALYTICKÝ DASHBOARD' :
                 appMode === 'PRE_SHIP' ? '⚓ PRE-SHIP KONTROLA / REVIZE' : '🔗 OPTIMIZAČNÍ SYNTÉZA KOMBÍK'
               }</span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <button 
              onClick={() => setAppMode('AUDIT')}
              className={cn(
                "p-5 text-left border transition-all flex flex-col justify-between group h-36 relative overflow-hidden",
                appMode === 'AUDIT' ? "bg-[#C5A059]/10 border-[#C5A059]" : "bg-[#111]/30 border-[#222] hover:border-[#444]"
              )}
            >
              <div className="flex justify-between items-start w-full">
                <Scale size={18} className={cn(appMode === 'AUDIT' ? "text-[#C5A059]" : "text-[#555] group-hover:text-[#C5A059]")} />
                <span className="text-[8px] font-mono text-white/20">PROC-V1</span>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white">Forenzní Juris-Audit</div>
                <div className="text-[9px] text-[#555] mt-1 leading-normal">Prověřit petiční nároky, rizika a integritu žalobního návrhu na základě 10 pilířů.</div>
              </div>
              {appMode === 'AUDIT' && <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]" />}
            </button>

            <button 
              onClick={() => setAppMode('COMPOSE')}
              className={cn(
                "p-5 text-left border transition-all flex flex-col justify-between group h-36 relative overflow-hidden",
                appMode === 'COMPOSE' ? "bg-[#C5A059]/10 border-[#C5A059]" : "bg-[#111]/30 border-[#222] hover:border-[#444]"
              )}
            >
              <div className="flex justify-between items-start w-full">
                <Sparkles size={18} className={cn(appMode === 'COMPOSE' ? "text-[#C5A059]" : "text-[#555] group-hover:text-[#C5A059]")} />
                <span className="text-[8px] font-mono text-white/20">PROC-V2</span>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white">Ko-Editační Drafting</div>
                <div className="text-[9px] text-[#555] mt-1 leading-normal">Sestavit doplňující repliku, vyjádření nebo zbrusu novou sekci ze zdrojů.</div>
              </div>
              {appMode === 'COMPOSE' && <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]" />}
            </button>

            <button 
              onClick={() => setAppMode('VERTICAL')}
              className={cn(
                "p-5 text-left border transition-all flex flex-col justify-between group h-36 relative overflow-hidden",
                appMode === 'VERTICAL' ? "bg-[#C5A059]/10 border-[#C5A059]" : "bg-[#111]/30 border-[#222] hover:border-[#444]"
              )}
            >
              <div className="flex justify-between items-start w-full">
                <History size={18} className={cn(appMode === 'VERTICAL' ? "text-[#C5A059]" : "text-[#555] group-hover:text-[#C5A059]")} />
                <span className="text-[8px] font-mono text-white/20">PROC-V3</span>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white">Vertikální Vývoj</div>
                <div className="text-[9px] text-[#555] mt-1 leading-normal">Chrono-komparace verzí celého podání či dokumentů. Sleduje vývoj žalobních argumentů.</div>
              </div>
              {appMode === 'VERTICAL' && <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]" />}
            </button>

            <button 
              onClick={() => setAppMode('SYNTHESIS')}
              className={cn(
                "p-5 text-left border transition-all flex flex-col justify-between group h-36 relative overflow-hidden",
                appMode === 'SYNTHESIS' ? "bg-[#C5A059]/10 border-[#C5A059]" : "bg-[#111]/30 border-[#222] hover:border-[#444]"
              )}
            >
              <div className="flex justify-between items-start w-full">
                <Layers size={18} className={cn(appMode === 'SYNTHESIS' ? "text-[#C5A059]" : "text-[#555] group-hover:text-[#C5A059]")} />
                <span className="text-[8px] font-mono text-white/20">PROC-V4</span>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white">Nejlepší Kombinace (Fúze)</div>
                <div className="text-[9px] text-[#555] mt-1 leading-normal">Sloučit a zfúzovat více různých draftů téhož dokumentu do jednoho suprémního textu.</div>
              </div>
              {appMode === 'SYNTHESIS' && <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]" />}
            </button>

            <button 
              onClick={() => setAppMode('DASHBOARD')}
              className={cn(
                "p-5 text-left border transition-all flex flex-col justify-between group h-36 relative overflow-hidden",
                appMode === 'DASHBOARD' ? "bg-[#C5A059]/10 border-[#C5A059]" : "bg-[#111]/30 border-[#222] hover:border-[#444]"
              )}
            >
              <div className="flex justify-between items-start w-full">
                <TrendingUp size={18} className={cn(appMode === 'DASHBOARD' ? "text-[#C5A059]" : "text-[#555] group-hover:text-[#C5A059]")} />
                <span className="text-[8px] font-mono text-white/20">PROC-V5</span>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white">Analytický Dashboard</div>
                <div className="text-[9px] text-[#555] mt-1 leading-normal">Forenzní metriky úspěšnosti pilířů v čase, kvalita spisu a auditní registr.</div>
              </div>
              {appMode === 'DASHBOARD' && <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]" />}
            </button>

            <button 
              onClick={() => setAppMode('PRE_SHIP')}
              className={cn(
                "p-5 text-left border transition-all flex flex-col justify-between group h-36 relative overflow-hidden",
                appMode === 'PRE_SHIP' ? "bg-[#C5A059]/10 border-[#C5A059]" : "bg-[#111]/30 border-[#222] hover:border-[#444]"
              )}
            >
              <div className="flex justify-between items-start w-full">
                <ShieldCheck size={18} className={cn(appMode === 'PRE_SHIP' ? "text-[#C5A059]" : "text-[#555] group-hover:text-[#C5A059]")} />
                <span className="text-[8px] font-mono text-white/20">PROC-V6</span>
              </div>
              <div className="mt-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-white">⚓ Pre-Ship Kontrola</div>
                <div className="text-[9px] text-[#555] mt-1 leading-normal">Slučování analýz, pre-ship automatické testy, společná kontrola kapitol.</div>
              </div>
              {appMode === 'PRE_SHIP' && <div className="absolute top-0 right-0 w-1 h-full bg-[#C5A059]" />}
            </button>
          </div>
        </section>

        <div className="grid gap-12 lg:grid-cols-12 border-t border-[#111] pt-12">
          {appMode === 'DASHBOARD' ? (
            <AnalyticsDashboard
              auditQueue={auditQueue}
              uploadedFiles={uploadedFiles}
              currentCaseId={currentCaseId}
              setAppMode={setAppMode}
              setActiveQueueId={setActiveQueueId}
              currentVersion={currentVersion}
              parseJsonFromResult={parseJsonFromResult}
              getRechartsData={getRechartsData}
              getPillarPerformanceData={getPillarPerformanceData}
            />
          ) : appMode === 'PRE_SHIP' ? (
            <PreShipControlView
              uploadedFiles={uploadedFiles}
              auditQueue={auditQueue}
              driveToken={driveToken}
            />
          ) : (
            <>
              <section className="lg:col-span-12 space-y-8">
            <div className="flex items-center justify-between bg-[#151515] border border-[#222] px-6 py-3">
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#C5A059] font-black">
                {appMode === 'AUDIT' ? '(01) PETIČNÍ_STRING_TERMINÁL' : 
                 appMode === 'COMPOSE' ? '(01) DRAFTING_COMPOSITION_ENGINE' : 
                 appMode === 'VERTICAL' ? '(01) POKYNY CHRONOLOGICKÉ KOMPARACE' : 
                 '(01) POKYNY PRO SYNTÉZU NEJLEPŠÍHO ZNĚNÍ'}
              </h2>
              <div className="flex gap-4">
                <button onClick={createNewVersion} className="text-[10px] uppercase font-black text-amber-600 hover:text-amber-500 transition-colors">Vytvořit Snapshot (Záloha)</button>
                <button onClick={() => setInputText('')} className="text-[10px] uppercase font-black text-[#666] hover:text-white transition-colors">Vymazat</button>
              </div>
            </div>
            <textarea 
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)} 
              placeholder={
                appMode === 'AUDIT' ? "ZADEJTE PRÁVNÍ ARGUMENTACI..." : 
                appMode === 'COMPOSE' ? "Zadejte pokyny pro sestavení nového dokumentu ze zdrojů..." :
                appMode === 'VERTICAL' ? "Zadejte specifické pokyny (např. Srovnej vývoj verze F18 vůči F16 a shrň jaké argumenty se oslabily)..." :
                "Zadejte upřednostňovaná kritéria nebo pravidla pro sloučení (např. Slouči tyto 3 verze, zachovej bodovou strukturu z V1 a do ní doplň judikaturu z V3)..."
              } 
              className="min-h-[400px] w-full border border-[#222] bg-[#151515] p-10 text-xl font-serif italic text-[#EEE] outline-none transition-all focus:border-[#C5A059] custom-scrollbar selection:bg-amber-900 shadow-2xl" 
            />
            <div className="space-y-4">
              <button 
                onClick={() => handleReview()} 
                disabled={isReviewing || (!inputText.trim() && selectedFileIds.length === 0 && (selectionMode === 'FILES' ? true : compareVersionIds.length === 0))} 
                className={cn(
                  "w-full py-8 text-sm font-black uppercase tracking-[0.5em] border transition-all flex items-center justify-center gap-4 group", 
                  isReviewing ? "border-amber-700 text-amber-700 cursor-wait" : 
                  (!inputText.trim() && selectedFileIds.length === 0 && (selectionMode === 'FILES' ? true : compareVersionIds.length === 0)) ? "border-[#222] text-[#333] cursor-not-allowed" :
                  "border-[#C5A059] text-white hover:bg-[#C5A059] hover:text-black"
                )}
              >
                {isReviewing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} className={cn((selectedFileIds.length > 0 || compareVersionIds.length > 0) ? "animate-pulse" : "")} />}
                {isReviewing ? 'Drtím_Data...' : 
                  appMode === 'VERTICAL' ? 'SPUSTIT CHROMO-VERTIKÁLNÍ ROZBOR EVOLUCE' :
                  appMode === 'SYNTHESIS' ? 'VYTVOŘIT NEJLEPŠÍ SYNTETIZOVANOU KOMBINACI' :
                  (selectionMode === 'VERSIONS' && compareVersionIds.length === 2) ? `POROVNAT ${compareVersionIds[0]} ➔ ${compareVersionIds[1]}` :
                  (selectionMode === 'VERSIONS' && compareVersionIds.length === 1) ? `AUDIT VERZE ${compareVersionIds[0]}` :
                  (!inputText.trim() && selectedFileIds.length > 0) ? `SPUSTIT AUDIT SOUBORŮ` : 
                  appMode === 'AUDIT' ? 'Spustit Analýzu Textu' : 'Sestavit Finální Návrh'}
              </button>
              {selectionMode === 'VERSIONS' && compareVersionIds.length === 0 && !isReviewing && (
                <div className="bg-blue-950/20 border border-blue-900/40 p-4 text-center">
                  <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest flex items-center justify-center gap-2">
                    <AlertCircle size={14}/> VYBERTE JEDNU NEBO DVĚ VERZE K ANALÝZE
                  </p>
                </div>
              )}
              {selectionMode === 'FILES' && !inputText.trim() && selectedFileIds.length === 0 && !isReviewing && (
                <div className="bg-amber-950/20 border border-amber-900/40 p-4 text-center">
                  <p className="text-[10px] font-black uppercase text-[#C5A059] tracking-widest flex items-center justify-center gap-2">
                    <AlertCircle size={14}/> K AUDITU JE NUTNÉ VYBRAT SOUBORY (KLIKNĚTE NA NÁZEV) NEBO ZADAT TEXT
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="lg:col-span-12 space-y-8 mb-20 scroll-mt-12" id="audit-output">
            <div className="flex items-center justify-between border-b border-[#222] pb-6">
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#777] font-black">(02) ANALYTICKÝ_AUDITNÍ_PROTOKOL</h2>
              {(reviewResult || (activeQueueId && auditQueue.find(t => t.id === activeQueueId)?.result)) && (
                <div className="flex gap-4">
                  <div className="flex gap-1 bg-[#111] p-1 border border-[#222]">
                    <button onClick={() => setViewMode('HTML')} className={cn("px-2 py-1 text-[8px] font-black uppercase transition-all", viewMode === 'HTML' ? "bg-[#C5A059] text-black" : "text-[#444]")}>Protocol</button>
                    <button onClick={() => setViewMode('MD')} className={cn("px-2 py-1 text-[8px] font-black uppercase transition-all", viewMode === 'MD' ? "bg-[#C5A059] text-black" : "text-[#444]")}>Markdown</button>
                    <button onClick={() => setViewMode('JSON')} className={cn("px-2 py-1 text-[8px] font-black uppercase transition-all", viewMode === 'JSON' ? "bg-[#C5A059] text-black" : "text-[#444]")}>JSON</button>
                  </div>
                  <div className="flex gap-4 items-center">
                    <button onClick={() => speakText(reviewResult)} className="text-[10px] uppercase font-black text-[#555] hover:text-emerald-500 flex items-center gap-2"><RefreshCcw size={14}/> Číst nahlas</button>
                    <button onClick={handleCopy} className="text-[10px] uppercase font-black text-[#555] hover:text-[#C5A059] flex items-center gap-2">{isCopied ? <Check size={14}/> : <Copy size={14}/>} {isCopied ? 'Uloženo' : 'Kopírovat'}</button>
                    <button onClick={printReport} className="text-[10px] uppercase font-black text-[#555] hover:text-white flex items-center gap-2"><FileDown size={14}/> Tisk / PDF</button>
                    <button onClick={() => activeQueueId && downloadReport(activeQueueId)} className="text-[10px] uppercase font-black text-[#555] hover:text-white flex items-center gap-2"><Download size={14}/> MD</button>
                    
                    {driveToken ? (
                      <button 
                        onClick={() => {
                          const activeVersion = activeQueueId ? (auditQueue.find(t => t.id === activeQueueId)?.version || currentVersion) : currentVersion;
                          const activeResult = activeQueueId ? (auditQueue.find(t => t.id === activeQueueId)?.result || '') : (reviewResult || '');
                          uploadAnalysisToDriveForVersion(activeVersion, activeResult);
                        }} 
                        disabled={isSavingAnalysisToDrive}
                        className="text-[10px] uppercase font-black text-[#C5A059] hover:text-emerald-400 flex items-center gap-2 border border-[#C5A059]/30 px-2 py-1 bg-[#C5A059]/5 hover:bg-[#C5A059]/10 transition-all disabled:opacity-50"
                      >
                        <Cloud size={14} className={isSavingAnalysisToDrive ? "animate-bounce" : ""} />
                        {isSavingAnalysisToDrive ? 'Ukládání...' : 'Uložit na Disk'}
                      </button>
                    ) : (
                      <button 
                        onClick={() => {
                          setShowDriveModal(true);
                        }}
                        className="text-[10px] uppercase font-black text-[#555] hover:text-[#C5A059] flex items-center gap-2 border border-[#222] px-2 py-1 bg-[#111] hover:bg-black transition-all"
                      >
                        <Cloud size={14} /> Zálohovat na Disk
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="min-h-[600px] bg-[#151515] border border-[#222] relative p-12 shadow-2xl custom-scrollbar-thin">
              <AnimatePresence mode="wait">
                {isReviewing ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-[#050505]/95 z-20">
                    <Loader2 size={40} className="animate-spin text-[#C5A059] mb-6 opacity-40" />
                    <div className="text-[10px] font-mono tracking-[0.8em] text-[#C5A059] uppercase animate-pulse">Dekonstrukce_Argumentů</div>
                  </motion.div>
                ) : (reviewResult || (activeQueueId && auditQueue.find(t => t.id === activeQueueId)?.result)) ? (
                  <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-p:text-[#999] prose-p:font-serif prose-p:italic prose-p:text-lg prose-strong:text-white prose-blockquote:border-l-[#C5A059] prose-blockquote:bg-[#111] prose-table:border-[#222]">
                    {viewMode === 'MD' && (
                      <ReactMarkdown>{activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result || '' : reviewResult || ''}</ReactMarkdown>
                    )}
                    {viewMode === 'JSON' && (
                      <div className="bg-[#050505] p-6 border border-[#222]">
                        <pre className="text-[10px] font-mono text-[#C5A059] overflow-x-auto">
                          {JSON.stringify(parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined), null, 2)}
                          {!parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined) && "// Žádná strukturovaná data k zobrazení"}
                        </pre>
                      </div>
                    )}
                    {viewMode === 'HTML' && (
                      <div className="space-y-12 not-prose">
                        <div className="flex items-center gap-4">
                          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#333]" />
                          <span className="text-[9px] font-black uppercase text-[#444] tracking-[0.4em]">§LG13§_DASHBOARD_v4</span>
                          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#333]" />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          <div className="border border-[#222] p-6 bg-[#111]">
                            <h3 className="text-[10px] font-black uppercase text-[#666] mb-4 flex items-center gap-2">
                              <CheckCircle2 size={14} className="text-emerald-500" /> Stav Dokumentace
                            </h3>
                            <div className="space-y-3 font-mono text-[9px] uppercase">
                              <div className="flex justify-between border-b border-[#222] pb-1"><span>ID:</span><span className="text-white">#{activeQueueId?.substring(0,6) || 'CORE'}</span></div>
                              <div className="flex justify-between border-b border-[#222] pb-1"><span>Spis:</span><span className="text-white">{cases.find(c => c.id === currentCaseId)?.nr}</span></div>
                              <div className="flex justify-between border-b border-[#222] pb-1"><span>Verze:</span><span className="text-white">{currentVersion}</span></div>
                              <div className="flex justify-between"><span>Audit:</span><span className="text-emerald-500">SCHVÁLENO</span></div>
                            </div>
                          </div>
                          
                          <div className="border border-[#222] p-6 bg-[#111] flex flex-col items-center justify-center text-center relative overflow-hidden">
                            <h3 className="text-[10px] font-black uppercase text-[#666] mb-4">
                              {(selectionMode === 'VERSIONS' || (activeQueueId && auditQueue.find(t => t.id === activeQueueId)?.version?.includes('+'))) ? 'Evoluční_Score' : 'Integrita_Score'}
                            </h3>
                            <div className="flex items-end gap-1">
                               <span className="text-6xl font-black text-white leading-none">
                                {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.score || 94}
                               </span>
                               <span className="text-xs text-[#333] mb-2">%</span>
                            </div>
                            {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.improvementPercent !== undefined && (
                              <div className={cn("text-[9px] font-bold mt-2", (parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.improvementPercent > 0) ? "text-emerald-500" : "text-red-500")}>
                                Δ {(parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.improvementPercent > 0) ? '+' : ''}{parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.improvementPercent}% oproti základu
                              </div>
                            )}
                            <div className="mt-4 w-full h-1 bg-[#222] rounded-full overflow-hidden">
                               <motion.div initial={{ width: 0 }} animate={{ width: `${parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.score || 94}%` }} className="h-full bg-[#C5A059]" />
                            </div>
                            {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.diffStats && (
                              <div className="mt-4 flex gap-4 w-full justify-center">
                                <div className="text-[8px] font-mono text-emerald-500">+{parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.diffStats.added} ADD</div>
                                <div className="text-[8px] font-mono text-red-500">-{parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.diffStats.removed} DEL</div>
                                <div className="text-[8px] font-mono text-blue-500">~{parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.diffStats.changed} CHG</div>
                              </div>
                            )}

                            {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.metrics && (
                              <div className="mt-4 grid grid-cols-2 gap-4 w-full border-t border-[#222] pt-4">
                                <div className="text-center">
                                  <div className="text-[7px] text-[#555] uppercase font-black tracking-widest">Síla (Strength)</div>
                                  <div className="text-lg font-black text-white">{parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.metrics.strength}%</div>
                                </div>
                                <div className="text-center">
                                  <div className="text-[7px] text-[#555] uppercase font-black tracking-widest">Prob. Úspěchu</div>
                                  <div className="text-lg font-black text-[#C5A059]">{parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.metrics.probability}%</div>
                                </div>
                              </div>
                            )}

                            {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.verdict && (
                              <div className={cn("mt-4 px-4 py-1 text-[8px] font-black uppercase tracking-widest w-full text-center", 
                                parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.verdict === 'SUBMIT' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500")}>
                                Verdikt: {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.verdict === 'SUBMIT' ? 'PODAT' : 'DALŠÍ ÚPRAVY'}
                              </div>
                            )}
                          </div>

                          <div className="border border-[#222] p-6 bg-[#111]">
                            <h3 className="text-[10px] font-black uppercase text-[#666] mb-4 flex items-center gap-2">
                              <AlertCircle size={14} className="text-[#C5A059]" /> Klíčová Doporučení
                            </h3>
                            <ul className="space-y-2 text-[10px] font-black uppercase text-[#C5A059]">
                               {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.recommendations?.slice(0,3).map((r: string, i: number) => (
                                 <li key={i} className="flex gap-2"><span>&raquo;</span> <span className="truncate">{r}</span></li>
                               ))}
                               {!parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.recommendations && (
                                 <li className="text-[#333]">Žádná doporučení k zobrazení</li>
                               )}
                            </ul>
                          </div>
                        </div>

                        {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions && (
                          <div className="border border-[#222] p-6 bg-[#0a0a0a]">
                            <h3 className="text-[10px] font-black uppercase text-[#666] mb-6 flex items-center gap-2">
                              <RotateCcw size={14} className="text-blue-500" /> Operační Mapa Změn & Revizí (§LG13§ Protocol)
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                              <div className="space-y-2">
                                <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest border-b border-emerald-900/30 pb-1">Nově Přidat (+)</div>
                                <ul className="text-[9px] text-[#888] space-y-1">
                                  {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.add?.length > 0 ? (
                                    parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.add.map((item: string, i: number) => (
                                      <li key={i} className="flex gap-2"><span>•</span> {item}</li>
                                    ))
                                  ) : <li className="opacity-30 italic">Žádné nové položky</li>}
                                </ul>
                              </div>
                              <div className="space-y-2">
                                <div className="text-[8px] font-black text-red-500 uppercase tracking-widest border-b border-red-900/30 pb-1">Odstranit (x)</div>
                                <ul className="text-[9px] text-[#888] space-y-1">
                                  {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.remove?.length > 0 ? (
                                    parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.remove.map((item: string, i: number) => (
                                      <li key={i} className="flex gap-2"><span>•</span> {item}</li>
                                    ))
                                  ) : <li className="opacity-30 italic">Žádné položky k odstranění</li>}
                                </ul>
                              </div>
                              <div className="space-y-2">
                                <div className="text-[8px] font-black text-blue-500 uppercase tracking-widest border-b border-blue-900/30 pb-1">Upravit / Refactor (~)</div>
                                <ul className="text-[9px] text-[#888] space-y-1">
                                  {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.modify?.length > 0 ? (
                                    parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.modify.map((item: string, i: number) => (
                                      <li key={i} className="flex gap-2"><span>•</span> {item}</li>
                                    ))
                                  ) : <li className="opacity-30 italic">Žádné úpravy</li>}
                                </ul>
                              </div>
                              <div className="space-y-2">
                                <div className="text-[8px] font-black text-[#C5A059] uppercase tracking-widest border-b border-[#C5A059]/30 pb-1">Vrátit z V-Předchozí (&larr;)</div>
                                <ul className="text-[9px] text-[#888] space-y-1">
                                  {parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.revert?.length > 0 ? (
                                    parseJsonFromResult(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)?.actions.revert.map((item: string, i: number) => (
                                      <li key={i} className="flex gap-2"><span>•</span> {item}</li>
                                    ))
                                  ) : <li className="opacity-30 italic">Žádné reverze</li>}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="space-y-4">
                           <h3 className="text-[10px] font-black uppercase text-[#666] tracking-widest pl-4 border-l-2 border-[#222]">Právní Atomy a Argumenty</h3>
                           <div className="grid gap-2">
                             <div className="bg-[#111] border border-[#222] p-8 font-serif italic text-xl text-[#DDD] leading-relaxed relative group overflow-hidden">
                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-all">
                                   <button onClick={() => speakText(activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result : reviewResult || undefined)} className="p-2 border border-[#333] hover:border-[#C5A059] text-[#666] hover:text-[#C5A059]"><RefreshCcw size={16}/></button>
                                </div>
                                <ReactMarkdown>{activeQueueId ? auditQueue.find(t => t.id === activeQueueId)?.result || '' : reviewResult || ''}</ReactMarkdown>
                             </div>
                           </div>
                        </div>

                        {/* JURIS_COGNITIVE_REMEDIATION_UNIT */}
                        <div className="border border-[#222] p-8 bg-[#0a0a0a] space-y-6 mb-8">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222] pb-4">
                            <div className="space-y-1">
                              <h3 className="text-[10px] font-black uppercase text-white tracking-widest flex items-center gap-2">
                                <Sparkles size={14} className="text-[#C5A059] animate-pulse" /> (02b) INTEGRAČNÍ KOUPEL & GENERÁTOR OPRAV (§LG13§ COGNITIVE UNIT)
                              </h3>
                              <p className="text-[9px] font-mono text-[#555]">
                                Automatická syntéza výsledků auditu. Vygenerujte strukturovaný nápravný list, nebo rovnou vytvořte přepracovaný vylepšený draft vyšší verze.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                onClick={generateFixAnalysisInstructions}
                                disabled={isGeneratingFixAnalysis || isGeneratingUpgrade}
                                className="px-4 py-2 border border-[#C5A059]/40 bg-[#C5A059]/5 text-[#C5A059] text-[9px] uppercase font-black hover:bg-[#C5A059] hover:text-black transition-all disabled:opacity-40 flex items-center gap-2"
                              >
                                {isGeneratingFixAnalysis ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
                                {isGeneratingFixAnalysis ? 'Generuji...' : 'Napsat Fix Analysis (Pokyny pro úpravu)'}
                              </button>
                              
                              <button
                                onClick={generateUpgradeToNextVersion}
                                disabled={isGeneratingUpgrade || isGeneratingFixAnalysis}
                                className="px-4 py-2 bg-gradient-to-r from-blue-950/80 to-emerald-950/80 border border-emerald-500/50 text-emerald-400 text-[9px] uppercase font-black hover:from-blue-900 hover:to-emerald-900 transition-all disabled:opacity-40 flex items-center gap-2"
                              >
                                {isGeneratingUpgrade ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                {isGeneratingUpgrade ? 'Upgraduji...' : `Vytvořit Návrh Nové Verze (${currentVersion} ➔ ${getNextVersion(currentVersion)})`}
                              </button>
                            </div>
                          </div>

                          {/* Fix Analysis instructions outcome rendering */}
                          {fixAnalysisText && (
                            <div className="bg-[#050505] border border-[#222] p-6 rounded-sm animate-in fade-in slide-in-from-top-2 duration-300">
                              <div className="flex items-center justify-between border-b border-[#111] pb-2 mb-4">
                                <span className="text-[8px] font-mono uppercase text-[#C5A059] font-black">NÁPRAVNÝ PROTOKOL A EDITAČNÍ SMĚRNICE</span>
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(fixAnalysisText || "");
                                    alert("Směrnice kopírován.");
                                  }} 
                                  className="text-[8px] font-mono uppercase text-[#C5A059] hover:underline"
                                >
                                  Kopírovat Pokyny
                                </button>
                              </div>
                              <div className="prose prose-invert prose-xs max-w-none text-[#999] font-mono text-[9px] leading-relaxed custom-scrollbar max-h-80 overflow-y-auto">
                                <ReactMarkdown>{fixAnalysisText}</ReactMarkdown>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="p-6 bg-emerald-950/10 border border-emerald-900/40 text-center">
                           <div className="text-[8px] font-mono text-emerald-800 uppercase tracking-[0.5em] mb-2">§LG13§ SECURITY GATEWAY</div>
                           <p className="text-[10px] font-black text-emerald-600 uppercase">Synchronizace s GitHub Repo v15.3 [CONCEPT_ACTIVE]</p>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full opacity-10">
                    <Scale size={60} strokeWidth={1} />
                    <div className="mt-8 text-[10px] font-mono uppercase tracking-[1em]">Vstup_Vyžadován</div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </section>
            </>
          )}
        </div>
      </main>

      <footer className="mx-auto max-w-7xl px-6 py-20 border-t border-[#222] flex flex-col md:flex-row justify-between items-center gap-12 opacity-80 transition-all">
        <div className="flex gap-20">
          <div><div className="text-[9px] font-black uppercase text-[#666] mb-2 tracking-widest">Integrita_Score</div><div className={cn("text-3xl font-black text-[#EAEAEA] tracking-tighter transition-all", isReviewing && "animate-pulse")}>{dynamicScore}%</div></div>
          <div><div className="text-[9px] font-black uppercase text-[#666] mb-2 tracking-widest">Riziko_Zásahu</div><div className={cn("text-3xl font-black text-[#C5A059] tracking-tighter transition-all", isReviewing && "animate-pulse")}>{dynamicRisk}</div></div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-mono text-[#555] uppercase tracking-[0.2em] mb-2 font-black">&copy; 2026 §LG13§ // CORE_ENGINE_v4</p>
          <div className="flex gap-4 justify-end items-center">
            <button onClick={clearAllData} className="text-[8px] font-black uppercase text-red-950 hover:text-red-600 transition-colors mr-4 flex items-center gap-1">
              <Trash2 size={10}/> Hard Reset
            </button>
            <span className="text-[8px] px-2 py-1 bg-[#1a1a1a] text-emerald-900 rounded border border-emerald-900/30">GITHUB_SYNCED</span>
            <span className="text-[8px] px-2 py-1 bg-[#1a1a1a] text-[#666] rounded border border-[#222]">TLS_ENCRYPTED</span>
            <span className="text-[8px] px-2 py-1 bg-[#1a1a1a] text-[#666] rounded border border-[#222]">NOZ_COMPLIANT</span>
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {showHelp && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-black/95 backdrop-blur-md">
            <div className="w-full h-full max-w-4xl bg-[#0A0A0A] border border-[#C5A059]/30 flex flex-col shadow-[0_0_50px_rgba(197,160,89,0.1)]">
              <div className="flex items-center justify-between px-8 py-6 border-b border-[#111]">
                <h2 className="text-xl font-black tracking-tighter text-[#C5A059]">§LG13§ // DOKUMENTACE_A_NÁPOVĚDA</h2>
                <button onClick={() => setShowHelp(false)} className="text-[#444] hover:text-white transition-colors"><X size={24}/></button>
              </div>
              <div className="flex-1 overflow-auto p-12 space-y-12 custom-scrollbar">
                <section className="space-y-4">
                  <h3 className="text-[10px] font-black uppercase text-[#666] tracking-[0.4em] flex items-center gap-2 mb-8">
                    <div className="w-2 h-2 bg-[#C5A059] animate-pulse" /> FILOZOFIE SYSTÉMU
                  </h3>
                  <p className="text-lg font-serif italic text-[#999] leading-relaxed">
                    §LG13§ není pouhý editor, ale forenzní orchestrátor právních podání. Systém pracuje na bázi "Právních Atomů" — nejmenších jednotek argumentace, které propojují FAKTA, PRÁVNÍ ZÁKLAD a DŮKAZY (přílohy).
                  </p>
                </section>

                <div className="grid md:grid-cols-2 gap-8">
                  <div className="border border-[#111] p-6 space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-white tracking-widest border-b border-[#222] pb-2">Auditní Režim</h4>
                    <p className="text-[11px] text-[#666] leading-relaxed font-mono uppercase">
                      Prověřuje existující dokumenty. K auditu vyberte soubory pomocí ORANŽOVÉ IKONY nebo hromadnou akcí "PŘIDAT K AUDITU". Referenční soubory (kontext) označte ZELENĚ/ŠEDĚ.
                    </p>
                  </div>
                  <div className="border border-[#111] p-6 space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-white tracking-widest border-b border-[#222] pb-2">Versioning & Snapshot</h4>
                    <p className="text-[11px] text-[#666] leading-relaxed font-mono uppercase">
                      "Vytvořit Snapshot" (dříve Fork) slouží k záloze aktuálního stavu podání. Umožňuje vám vytvořit novou verzi a pokračovat v práci bez ovlivnění předchozích draftů.
                    </p>
                  </div>
                </div>

                <section className="space-y-4 pt-8 border-t border-[#111]">
                  <h3 className="text-[10px] font-black uppercase text-[#666] tracking-[0.4em] mb-8">GIT REPO INTEGRACE & STRUKTURA</h3>
                  <div className="bg-[#050505] p-6 border border-[#222] font-mono text-[10px] space-y-4">
                    <p className="text-[#C5A059]">Systém LG13 využívá externí kontext z GitHubu k synchronizaci "Atomárních Šablon".</p>
                    <div className="grid grid-cols-2 gap-4 text-[#444]">
                      <div>
                        <div className="text-white mb-2 underline">Očekávaná Struktura:</div>
                        <div>/atoms - Definice procesních atomů</div>
                        <div>/clauses - Knihovna prověřených doložek</div>
                        <div>/templates - Strukturované drafty</div>
                      </div>
                      <div>
                        <div className="text-white mb-2 underline">Způsob využití:</div>
                        <div>AI v každém promptu zohledňuje URL zadané v poli "Git Repo". Pokud je repo veřejné, AI analytika využívá jeho strukturu k validaci vaší argumentace.</div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4 pt-8 border-t border-[#111]">
                  <h3 className="text-[10px] font-black uppercase text-[#666] tracking-[0.4em] mb-8">HANDSHAKE POLICY PROTOKOL & ADRESÁŘOVÁ STRUKTURA CONTROLY</h3>
                  <div className="bg-[#050505] p-6 border border-[#222] font-mono text-[10px] space-y-4">
                    <p className="text-[#C5A059]">Pro uvolnění systémových zámků doručovací fronty (Pipeline Locks Release) je definován následující Handshake protokol:</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-[#999] leading-relaxed">
                      <div>
                        <div className="text-white mb-2 underline">Adresářová struktura na GDrive:</div>
                        <p>Ve složce pojmenované přesně <span className="text-[#C5A059]">PRE_Ship_Final_Control</span>: </p>
                        <div className="bg-[#111] p-3 border border-[#222] text-[#777] mt-1 space-y-1">
                          <div>├── <span className="text-white">JURIS_UNLOCK_CERTIFICATE.json</span> (vygenerovaný odblokátor)</div>
                          <div>├── <span className="text-white">*.pdf</span> (podepsané hlavní podání)</div>
                          <div>├── <span className="text-white">*.zip</span> (doprovodné důkazy a auditní stopy)</div>
                          <div>└── <span className="text-white">handshake_release_notes.txt</span> (přepravní text)</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-white mb-2 underline">Fungování Handshake:</div>
                        <p>
                          1. V menu ⚓ <strong>Pre-Ship Kontrola</strong> spustíte autonomní compliance testy.<br />
                          2. Systém vygeneruje bezpečný JSON certifikát s časovým razítkem a unikátním hash klíčem.<br />
                          3. Kliknutím na <strong>"Uložit certifikát na Disk"</strong> zapíšete soubor na GDrive. CI/CD pipeline monitoruje tuto složku, najde certifikát a uvolní zámky pro přenos do datové schránky.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4 pt-8 border-t border-[#111]">
                  <h3 className="text-[10px] font-black uppercase text-[#666] tracking-[0.4em] mb-8">AUTHENTICATION & GOOGLE TASKS TROUBLESHOOTING</h3>
                  <div className="bg-rose-950/10 p-6 border border-rose-950/40 font-mono text-[10px] space-y-4">
                    <p className="text-rose-400 font-bold">Pokud se Vám nedaří přihlásit ke Google Tasks / Disku nebo Firebase hlásí chybu domény:</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-[#999] leading-relaxed">
                      <div>
                        <div className="text-white mb-2 underline">A] Chyba Authorized Domain (Firebase Console):</div>
                        <p>
                          Při povolování v Firebase administraci (Authentication → Settings → Authorized Domains) **NESMÍ** být doména zadána s portem (např. <code className="text-rose-300">localhost:8000</code> je neplatná konfigurace). Zadejte pouze čisté domény:<br />
                          • <code className="text-[#C5A059]">localhost</code> (pro lokální vývoj na jakémkoliv portu)<br />
                          • <code className="text-white">ais-dev-zlbq3lae3dpllrbz5iwujp-521807296593.europe-west2.run.app</code><br />
                          • ...a vaše další produkční či sdílené domény Cloud Run kontejneru.
                        </p>
                      </div>
                      <div>
                        <div className="text-white mb-2 underline">B] Povolení Google Tasks Scopes:</div>
                        <p>
                          Před prvním použitím si v levém panelu v sekci Google disků klikněte na sign-in tlačítko Google a odsouhlaste dodatečná oprávnění ke čtení a zápisu Vašich Google Tasks. Pokud integrace zůstává neaktivní, odhlaste se kliknutím na ikonu úniku a přihlaste se znovu k pročištění token cache.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4 pt-8 border-t border-[#111]">
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 text-[10px] font-mono">
                      <div className="px-2 py-1 bg-[#222] text-white">SELECT</div>
                      <span className="text-[#444]">LMB na soubor pro výběr k analýze.</span>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] font-mono">
                      <div className="px-2 py-1 bg-[#222] text-white">CONTEXT</div>
                      <span className="text-[#444]">RMB na soubor pro označení jako REFERENCE (Kontext).</span>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] font-mono">
                      <div className="px-2 py-1 bg-[#222] text-white">BULK_CHECK</div>
                      <span className="text-[#444]">Checkbox pro hromadné operace (Kategorie, Smazání, Archivace).</span>
                    </div>
                  </div>
                </section>

                <div className="p-8 bg-[#C5A059]/5 border border-[#C5A059]/20">
                  <p className="text-[9px] font-mono text-[#C5A059] uppercase leading-relaxed font-black font-sans">
                    UPOZORNĚNÍ: SYSTÉM VYŽADUJE AKTIVNÍ PŘIPOJENÍ K §LG13§ CLOUD ENGINE. VEŠKERÁ DATA JSOU ŠIFROVÁNA TLS 1.3. SYSTÉM NEPOSKYTUJE PRÁVNÍ PORADENSTVÍ, ALE FORENZNÍ DOKUMENTAČNÍ ASISTENCI.
                  </p>
                </div>
              </div>
              <div className="px-8 py-6 border-t border-[#111] flex justify-between items-center">
                <div className="flex gap-4">
                  <button onClick={clearAllData} className="text-[10px] font-black uppercase text-red-900 hover:text-red-500 flex items-center gap-2">
                    <Trash2 size={14}/> Hard Reset (Smazat vše)
                  </button>
                  <button onClick={() => downloadReport('README')} className="text-[10px] font-black uppercase text-[#444] hover:text-white flex items-center gap-2">
                    <Download size={14}/> Stáhnout User Guide (MD)
                  </button>
                  <button onClick={downloadTechnicalReadme} className="text-[10px] font-black uppercase text-[#C5A059] hover:text-white flex items-center gap-2">
                    <FileJson size={14}/> Stáhnout Technickou Dokumentaci (MD)
                  </button>
                </div>
                <div className="text-[8px] font-mono text-[#333]">ENGINE_HASH: 0xLG13_V4_STABLE</div>
              </div>
            </div>
          </motion.div>
        )}

        {previewFile && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/90 backdrop-blur-sm">
            <div className="w-full h-full max-w-5xl bg-[#151515] border border-[#222] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#222]">
                <div className="flex items-center gap-4">
                  <div className="px-2 py-1 bg-[#C5A059] text-black text-[9px] font-black uppercase">PREVIEW</div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-white">{previewFile.name}</h3>
                </div>
                <button onClick={() => setPreviewFile(null)} className="text-[#666] hover:text-white transition-colors p-2">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 bg-white relative overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center text-black font-mono text-xs italic p-12 text-center opacity-30 select-none pointer-events-none">
                  // §LG13§ SECURE PREVIEW SYSTEM // RENDERED IN SANDBOX
                </div>
                {previewFile.type === 'PDF' ? (
                  <iframe src={URL.createObjectURL(new Blob([], { type: 'application/pdf' }))} className="w-full h-full border-none" title="PDF Preview" />
                ) : (
                  <div className="w-full h-full overflow-auto p-12 text-black font-serif italic text-lg leading-relaxed">
                    [Obsah souboru s volnou textovou strukturou]
                  </div>
                )}
              </div>
              <div className="px-6 py-4 bg-[#111] border-t border-[#222] flex justify-between items-center text-[9px] font-mono text-[#444]">
                <span>FILE_ID: {previewFile.id}</span>
                <span>SECURED_WITH_TLS_ENCRYPTION</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Case Creation Modal */}
      <AnimatePresence>
        {showCaseModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-6">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#111] border border-[#C5A059] p-8 max-w-md w-full shadow-[0_0_50px_rgba(197,160,89,0.2)]"
            >
              <div className="flex justify-between items-center mb-8 border-b border-[#222] pb-4">
                <h2 className="text-xl font-black uppercase tracking-widest text-[#C5A059]">NOVÝ_SPISOVÝ_ZÁZNAM</h2>
                <button onClick={() => setShowCaseModal(false)} className="text-[#444] hover:text-white"><X size={20}/></button>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-[#666] tracking-widest">Jednací číslo / ID</label>
                  <input 
                    type="text" 
                    value={newCaseData.nr} 
                    onChange={(e) => setNewCaseData(prev => ({ ...prev, nr: e.target.value }))}
                    className="w-full bg-[#0a0a0a] border border-[#222] p-4 text-white font-mono outline-none focus:border-[#C5A059] transition-all"
                    placeholder="2026/LG/13..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-[#666] tracking-widest">Název Spisu</label>
                  <input 
                    type="text" 
                    value={newCaseData.name} 
                    onChange={(e) => setNewCaseData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-[#0a0a0a] border border-[#222] p-4 text-white uppercase font-black outline-none focus:border-[#C5A059] transition-all"
                    placeholder="NÁZEV PŘÍPADU..."
                  />
                </div>
                
                <div className="pt-4 flex flex-col gap-4">
                  <button 
                    onClick={confirmCreateCase}
                    className="w-full py-4 bg-[#C5A059] text-black font-black uppercase tracking-[0.2em] hover:bg-white transition-all flex items-center justify-center gap-2"
                  >
                    <Plus size={16}/> Vytvořit sezení
                  </button>
                  <p className="text-[9px] text-[#444] text-center uppercase leading-relaxed font-black">
                    Vytvořením nového spisu dojde k aktivaci prázdného kontextu a resetu aktuálních výběrů k auditu.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Google Drive Importer Modal */}
      <AnimatePresence>
        {showDriveModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-6">
            <motion.div 
               initial={{ scale: 0.9, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.9, opacity: 0 }}
               className="bg-[#111] border border-[#C5A059] p-8 max-w-2xl w-full shadow-[0_0_50px_rgba(197,160,89,0.3)] flex flex-col max-h-[90vh] relative overflow-hidden"
            >
              {/* Recursive Folder Import Progress Overlay */}
              {isImportingFolder && (
                <div className="absolute inset-0 bg-[#0c0c0c]/98 z-50 flex flex-col items-center justify-center p-8 text-center space-y-6">
                  <div className="p-4 bg-[#C5A059]/5 border border-[#C5A059]/20 rounded-full text-[#C5A059]">
                    <Loader2 size={40} className="animate-spin" />
                  </div>
                  <div className="space-y-3 max-w-md">
                    <p className="text-[12px] uppercase font-black tracking-[0.2em] text-[#C5A059]">REKURZIVNÍ_IMPORT_SOUBORŮ</p>
                    <p className="text-[10px] text-zinc-400 font-mono leading-relaxed truncate px-4">
                      {importStatus || 'Prohledávání struktury složek a stahování...'}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center mb-6 border-b border-[#222] pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <Cloud className="text-[#C5A059]" size={22} />
                  <h2 className="text-xl font-black uppercase tracking-widest text-[#C5A059]">DISK_GOOGLE_INTEGRITY</h2>
                </div>
                <button onClick={() => setShowDriveModal(false)} className="text-[#444] hover:text-white transition-colors">
                  <X size={20}/>
                </button>
              </div>

              {!driveToken ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-6 shrink-0">
                  <div className="p-4 bg-[#C5A059]/5 border border-[#C5A059]/20 rounded-full text-[#C5A059]">
                    <Cloud size={40} className="animate-pulse" />
                  </div>
                  <div className="space-y-2 max-w-md">
                    <p className="text-[12px] uppercase font-black tracking-wider text-white">Připojit Disk Google</p>
                    <p className="text-[10px] text-[#666] leading-relaxed">
                      Pro procházení a nahrávání vašich souborů, tabulek a dokumentů z Disku Google je vyžadováno jednorázové udělení oprávnění.
                    </p>
                  </div>
                  <button 
                    onClick={login}
                    className="px-6 py-3 bg-[#C5A059] text-black text-[11px] uppercase font-black tracking-widest hover:bg-white transition-colors flex items-center gap-2"
                  >
                    <LogIn size={14} /> Povolit přístup k Disku Google
                  </button>
                </div>
              ) : (
                <div className="flex flex-col flex-1 overflow-hidden space-y-4">
                  {/* Option 1: URL/ID Import */}
                  <div className="bg-[#0c0c0c] border border-[#222] p-4 shrink-0 space-y-3">
                    <h3 className="text-[10px] font-black uppercase tracking-wider text-[#C5A059]">Přímý import z URL nebo ID složky/souboru</h3>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        placeholder="Vložit odkaz: složka (https://drive.google.com/drive/folders/...) nebo ID"
                        value={driveUrlInput}
                        onChange={(e) => setDriveUrlInput(e.target.value)}
                        className="flex-1 bg-black border border-[#222] p-3 text-[11px] font-mono outline-none text-white focus:border-[#C5A059]"
                      />
                      <button 
                        onClick={() => {
                          if (driveUrlInput) {
                            handleUrlOrIdImport(driveUrlInput);
                            setDriveUrlInput('');
                          }
                        }}
                        disabled={isImportingFile || isImportingFolder}
                        className="px-4 bg-[#C5A059] text-black text-[10px] uppercase font-black hover:bg-white transition-colors disabled:opacity-50"
                      >
                        {isImportingFile || isImportingFolder ? 'Načítání...' : 'Načíst'}
                      </button>
                    </div>
                  </div>

                  {/* Option 2: Browser */}
                  <div className="flex flex-col flex-1 overflow-hidden space-y-3">
                    <div className="flex justify-between items-center shrink-0">
                      <h3 className="text-[10px] font-black uppercase tracking-wider text-white flex items-center gap-2">
                        <FolderOpen size={12} className="text-[#C5A059]" /> Prohlížeč Disku Google
                      </h3>
                      <button 
                        onClick={() => fetchDriveFiles(currentDriveFolderId, driveToken)}
                        disabled={isFetchingDrive}
                        className="text-[9px] uppercase font-black font-mono text-[#666] hover:text-[#C5A059] flex items-center gap-1"
                      >
                        <RefreshCcw size={10} className={isFetchingDrive ? "animate-spin" : ""} /> Aktualizovat
                      </button>
                    </div>

                    {/* Interactive Breadcrumbs Navigation */}
                    <div className="flex flex-wrap items-center gap-1.5 p-2.5 bg-[#0a0a0a] border border-[#222] text-[10px] font-mono shrink-0">
                      <button 
                        onClick={() => navigateToBreadcrumb(-1)}
                        className="text-[#666] hover:text-[#C5A059] transition-colors"
                      >
                        Disk Google (Root)
                      </button>
                      {driveFolderHistory.map((item, index) => (
                        <span key={item.id} className="flex items-center gap-1.5 text-[#333]">
                          <span>/</span>
                          <button 
                            onClick={() => navigateToBreadcrumb(index)}
                            className={cn(
                              "hover:text-white transition-colors", 
                              index === driveFolderHistory.length - 1 ? "text-[#C5A059] font-black" : "text-[#666]"
                            )}
                          >
                            {item.name}
                          </button>
                        </span>
                      ))}
                    </div>

                    <div className="shrink-0 flex gap-2">
                      <input 
                        type="text"
                        placeholder="Hledat v této složce..."
                        value={driveSearchQuery}
                        onChange={(e) => setDriveSearchQuery(e.target.value)}
                        className="w-full bg-black border border-[#222] p-2 text-[10px] outline-none text-white focus:border-[#C5A059]"
                      />
                      
                      {currentDriveFolderId !== 'root' && (
                        <button 
                          onClick={() => {
                            const activeFolderName = driveFolderHistory.length > 0 ? driveFolderHistory[driveFolderHistory.length - 1].name : 'Složka';
                            importDriveFolderRecursively(currentDriveFolderId, activeFolderName, driveToken);
                          }}
                          disabled={isImportingFolder}
                          className="shrink-0 px-3 bg-[#C5A059] text-black text-[9px] uppercase font-black hover:bg-white transition-all disabled:opacity-50"
                        >
                          Importovat tuto složku rekurzivně
                        </button>
                      )}
                    </div>

                    {driveError && (
                      <div className="bg-red-950/20 border border-red-500/20 p-3 text-[10px] text-red-400 font-mono shrink-0">
                        {driveError}
                      </div>
                    )}

                    <div className="flex-1 overflow-y-auto border border-[#222] bg-[#0c0c0c] min-h-[180px]">
                      {isFetchingDrive ? (
                        <div className="h-full flex flex-col items-center justify-center p-8 space-y-2">
                          <Loader2 size={24} className="animate-spin text-[#C5A059]" />
                          <span className="text-[9px] uppercase font-mono text-[#666]">Načítání položek z Disku...</span>
                        </div>
                      ) : driveFiles.length === 0 ? (
                        <div className="h-full flex items-center justify-center p-8 text-center text-[#666] text-[10px] uppercase font-mono">
                          Tato složka je prázdná nebo neobsahuje podporované soubory.
                        </div>
                      ) : (
                        <div className="divide-y divide-[#181818]">
                          {driveFiles
                            .filter(f => f.name.toLowerCase().includes(driveSearchQuery.toLowerCase()))
                            .map((file) => {
                              const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                              const isDoc = file.mimeType.includes('document');
                              const isSheet = file.mimeType.includes('spreadsheet');
                              const isPdf = file.mimeType.includes('pdf');
                              const isZip = file.mimeType === 'application/zip' || file.mimeType === 'application/x-zip-compressed' || file.name.toLowerCase().endsWith('.zip');

                              return (
                                <div 
                                  key={file.id} 
                                  className={cn(
                                    "group flex justify-between items-center p-2.5 transition-all hover:bg-[#111]",
                                    isFolder ? "cursor-pointer" : ""
                                  )}
                                  onClick={(e) => {
                                    if (isFolder) {
                                      navigateToDriveFolder(file.id, file.name);
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-3 overflow-hidden mr-4">
                                    <div className="shrink-0">
                                      {isFolder ? (
                                        <FolderOpen className="text-amber-500" size={16} />
                                      ) : isDoc ? (
                                        <FileText className="text-[#3b82f6]" size={16} />
                                      ) : isSheet ? (
                                        <FileJson className="text-emerald-500" size={16} />
                                      ) : isPdf ? (
                                        <Scale className="text-red-500" size={16} />
                                      ) : isZip ? (
                                        <Archive className="text-amber-400" size={16} />
                                      ) : (
                                        <FileText className="text-[#666]" size={16} />
                                      )}
                                    </div>
                                    <div className="truncate">
                                      <p className={cn(
                                        "text-[11px] truncate", 
                                        isFolder ? "font-black text-[#C5A059] group-hover:text-white" : "font-bold text-[#EAEAEA]"
                                      )}>
                                        {file.name}
                                      </p>
                                      <p className="text-[8px] font-mono text-[#444] uppercase tracking-tighter">
                                        ID: {file.id} | UPRAVENO:{' '}
                                        {new Date(file.modifiedTime).toLocaleDateString('cs-CZ')}
                                      </p>
                                    </div>
                                  </div>
                                  
                                  <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    {isFolder ? (
                                      <button 
                                        onClick={() => importDriveFolderRecursively(file.id, file.name, driveToken)}
                                        className="px-2.5 py-1 bg-amber-950/40 border border-amber-900/30 text-amber-500 hover:border-amber-400 hover:bg-amber-500 hover:text-black text-[8px] uppercase font-black transition-all"
                                      >
                                        Importovat Složku
                                      </button>
                                    ) : (
                                      <button 
                                        onClick={() => importDriveFile(file.id, file.name, file.mimeType, driveToken)}
                                        disabled={isImportingFile}
                                        className="px-2.5 py-1 bg-[#222] border border-[#333] hover:border-[#C5A059] hover:bg-[#C5A059] hover:text-black text-[8px] uppercase font-black transition-all disabled:opacity-50"
                                      >
                                        {isZip ? 'Rozbalit' : 'Import'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Priority Folder Selector Modal */}
      <AnimatePresence>
        {driveFoldersToImportPrompt && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-md p-6">
            <motion.div 
               initial={{ scale: 0.9, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.9, opacity: 0 }}
               className="bg-[#111] border border-[#C5A059] p-8 max-w-lg w-full shadow-[0_0_50px_rgba(197,160,89,0.3)] flex flex-col max-h-[85vh] relative overflow-hidden"
            >
              <div className="flex justify-between items-center mb-6 border-b border-[#222] pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <Database className="text-[#C5A059]" size={22} />
                  <h2 className="text-sm font-black uppercase tracking-widest text-[#C5A059]">CHYTRÉ NAČTENÍ HIERARCHIE</h2>
                </div>
                <button onClick={() => setDriveFoldersToImportPrompt(null)} className="text-[#444] hover:text-white transition-colors">
                  <X size={20}/>
                </button>
              </div>

              <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
                <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                  V úložišti <strong className="text-white">Google_LG13_Lex</strong> bylo nalezeno <strong className="text-[#C5A059]">{driveFoldersToImportPrompt.length}</strong> verzovaných složek s daty k forenzní analýze. 
                  Chcete nahrát vše najednou, nebo označit ty s nejvyšší prioritou? Zbytek složek se dohraje a zindexuje automaticky na pozadí.
                </p>

                <div className="flex items-center justify-between bg-[#151515]/20 border border-[#222]/40 px-3 py-2 rounded-sm shrink-0">
                  <span className="text-[8px] font-black uppercase tracking-wider text-zinc-500">Výběr Priorit:</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = driveFoldersToImportPrompt.map(folder => ({ ...folder, selected: true }));
                        setDriveFoldersToImportPrompt(updated);
                      }}
                      className="text-[9px] font-black uppercase text-[#C5A059] border border-[#C5A059]/20 px-2.5 py-1 hover:bg-[#C5A059]/10 transition-all bg-transparent cursor-pointer"
                    >
                      ✓ Označit vše
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = driveFoldersToImportPrompt.map(folder => ({ ...folder, selected: false }));
                        setDriveFoldersToImportPrompt(updated);
                      }}
                      className="text-[9px] font-black uppercase text-zinc-400 border border-zinc-800 px-2.5 py-1 hover:text-white hover:border-zinc-700 transition-all bg-transparent cursor-pointer"
                    >
                      ✗ Smazat výběr (označit 0)
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border border-[#222] bg-[#0c0c0c] p-4 space-y-2 rounded-sm custom-scrollbar">
                  {driveFoldersToImportPrompt.map((f, idx) => (
                    <label key={f.id} className="flex items-center gap-3 p-2 hover:bg-[#151515] rounded cursor-pointer transition-colors border border-transparent hover:border-[#222]">
                      <input 
                        type="checkbox" 
                        checked={f.selected} 
                        onChange={(e) => {
                          const updated = [...driveFoldersToImportPrompt];
                          updated[idx].selected = e.target.checked;
                          setDriveFoldersToImportPrompt(updated);
                        }}
                        className="rounded border-[#C5A059] text-[#C5A059] focus:ring-[#C5A059] w-4 h-4 bg-black"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-white uppercase tracking-wider">{f.name}</p>
                        <p className="text-[9px] font-mono text-zinc-500">ID: {f.id}</p>
                      </div>
                      <span className="text-[9px] font-mono text-[#C5A059] bg-[#C5A059]/10 px-2 py-0.5 rounded uppercase">
                        {f.selected ? 'Prioritní' : 'Na pozadí'}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0 pt-4">
                  <button
                    onClick={() => {
                      if (!driveToken) return;
                      // Load All
                      driveFoldersToImportPrompt.forEach(folder => {
                        autoImportSingleVersionFolder(folder.id, folder.name, driveToken);
                      });
                      setDriveFoldersToImportPrompt(null);
                    }}
                    className="w-full py-3 border border-[#333] hover:border-[#C5A059] font-mono text-[10px] uppercase font-black tracking-wider text-zinc-400 hover:text-white transition-all bg-transparent cursor-pointer"
                  >
                    Nahrát vše najednou
                  </button>
                  <button
                    onClick={() => {
                      if (!driveToken) return;
                      const selectedFolders = driveFoldersToImportPrompt.filter(f => f.selected);
                      const unselectedFolders = driveFoldersToImportPrompt.filter(f => !f.selected);

                      if (selectedFolders.length === 0) {
                        alert("Prosím zvolte alespoň jednu složku jako prioritní, nebo zvolte možnost nahrát vše najednou.");
                        return;
                      }

                      // Set up priority and background tracking
                      const prioritySet = new Set(selectedFolders.map(f => f.name));
                      setPriorityImportIds(prioritySet);
                      setBackgroundImportQueue(unselectedFolders.map(f => ({ id: f.id, name: f.name })));
                      setBackgroundImportStarted(false);

                      // Download priority ones immediately
                      selectedFolders.forEach((folder) => {
                        autoImportSingleVersionFolder(folder.id, folder.name, driveToken);
                      });

                      setDriveFoldersToImportPrompt(null);
                      alert(`Spuštěno prioritní nahrávání pro ${selectedFolders.length} složek. Zbylých ${unselectedFolders.length} složek bude dohráno na pozadí poté, co prioritní dojdou do stavu 'DONE' a budou připraveny k analýze.`);
                    }}
                    className="w-full py-3 bg-[#C5A059] hover:bg-white text-black font-mono text-[10px] uppercase font-black tracking-wider transition-all cursor-pointer"
                  >
                    Prioritně vybrané & zbytek pozadí
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* INTEGROVANÝ POTVRZOVACÍ DIALOG (BYPASS PRO IFRAME BLOKACE) */}
      <AnimatePresence>
        {confirmDialog && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="w-full max-w-md bg-[#0d0d0d] border border-amber-500/30 p-6 space-y-6 rounded-sm shadow-2xl shadow-amber-500/5"
            >
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-[#C5A059] flex items-center gap-2">
                  ⚠️ SYSTÉMOVÉ POTVRZENÍ
                </h4>
                <p className="text-[11px] font-mono text-white/95 uppercase mt-4 font-bold leading-relaxed">
                  {confirmDialog.title}
                </p>
                <p className="text-[9px] font-mono text-[#777] uppercase mt-2 leading-relaxed">
                  {confirmDialog.message}
                </p>
              </div>
              <div className="flex justify-end gap-3 text-[9px] font-black uppercase font-mono tracking-wider pt-4 border-t border-[#1a1a1a]">
                <button 
                  onClick={() => setConfirmDialog(null)}
                  className="px-4 py-2 border border-[#222] text-[#888] hover:text-white transition-all cursor-pointer bg-transparent"
                >
                  Storno
                </button>
                <button 
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  }}
                  className="px-4 py-2 border border-amber-500/50 bg-amber-500/10 text-[#C5A059] hover:bg-[#C5A059] hover:text-black transition-all cursor-pointer"
                >
                  Potvrdit akci
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
