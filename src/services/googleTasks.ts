export interface GoogleTaskList {
  id: string;
  title: string;
  updated: string;
  selfLink: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  updated: string;
  selfLink: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  completed?: string;
  due?: string;
}

const BASE_URL = 'https://tasks.googleapis.com/v1';

async function fetchWithAuth(url: string, token: string, options: RequestInit = {}) {
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Tasks API Error: ${response.status} - ${errText}`);
  }
  return response.json();
}

export async function getOrCreateJurisTaskList(token: string): Promise<string> {
  try {
    const data = await fetchWithAuth(`${BASE_URL}/users/@me/lists`, token);
    const lists = (data.items || []) as GoogleTaskList[];
    const existing = lists.find(l => l.title === '§LG13§ Juris-Audits' || l.title.includes('Juris-Audits'));
    if (existing) {
      return existing.id;
    }

    // Create a new task list
    const newList = await fetchWithAuth(`${BASE_URL}/users/@me/lists`, token, {
      method: 'POST',
      body: JSON.stringify({ title: '§LG13§ Juris-Audits' }),
    });
    return newList.id;
  } catch (error) {
    console.error('Error getting/creating Google TaskList:', error);
    throw error;
  }
}

export async function fetchJurisTasks(token: string, taskListId: string): Promise<GoogleTask[]> {
  try {
    const data = await fetchWithAuth(`${BASE_URL}/lists/${taskListId}/tasks?showCompleted=true&showHidden=true`, token);
    return (data.items || []) as GoogleTask[];
  } catch (error) {
    console.error('Error fetching tasks from Google TaskList:', error);
    throw error;
  }
}

export async function createJurisTask(
  token: string, 
  taskListId: string, 
  title: string, 
  notes?: string
): Promise<GoogleTask> {
  try {
    return await fetchWithAuth(`${BASE_URL}/lists/${taskListId}/tasks`, token, {
      method: 'POST',
      body: JSON.stringify({
        title,
        notes,
        status: 'needsAction'
      }),
    });
  } catch (error) {
    console.error('Error creating task in Google Tasks:', error);
    throw error;
  }
}

export async function completeJurisTask(
  token: string,
  taskListId: string,
  taskId: string
): Promise<GoogleTask> {
  try {
    return await fetchWithAuth(`${BASE_URL}/lists/${taskListId}/tasks/${taskId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
        completed: new Date().toISOString()
      }),
    });
  } catch (error) {
    console.error('Error completing Google task:', error);
    throw error;
  }
}

export async function deleteJurisTask(
  token: string,
  taskListId: string,
  taskId: string
): Promise<void> {
  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
    };
    const response = await fetch(`${BASE_URL}/lists/${taskListId}/tasks/${taskId}`, {
      method: 'DELETE',
      headers
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Tasks API Delete Error: ${response.status} - ${errText}`);
    }
  } catch (error) {
    console.error('Error deleting Google task:', error);
    throw error;
  }
}
