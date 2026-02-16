import React, { useMemo, useState, useEffect } from 'react';
import { DateTime } from 'luxon';
import {
  joinHousehold,
  fetchMembers,
  fetchTasks,
  fetchLists,
  createTask,
  updateTask,
  completeTask,
  transferTask,
  nudgeTask,
  deleteTask,
  addMember,
  deleteMember,
  resetMemberColors,
  createList,
  createListItem,
  updateListItem,
  deleteListItem,
  deleteList,
  exportHousehold,
  importHousehold,
  fetchPushPublicKey,
  savePushSubscription,
  fetchPushStatus,
  sendPushTest
} from './api.js';
import {
  todayISO,
  formatDate,
  formatDateShort,
  weekRange,
  isOverdue,
  isToday,
  isInWeek,
  RECURRENCE_LABELS,
  TZ,
  LOCALE
} from './date.js';
import { loadSession, saveSession, clearSession } from './storage.js';

const VIEWS = [
  { id: 'today', label: 'Heute' },
  { id: 'family', label: 'Familie' },
  { id: 'week', label: 'Woche' },
  { id: 'tasks', label: 'Aufgaben' },
  { id: 'lists', label: 'Listen' },
  { id: 'settings', label: 'Einstellungen' }
];

const RECURRENCE_OPTIONS = [
  { value: 'once', label: RECURRENCE_LABELS.once },
  { value: 'daily', label: RECURRENCE_LABELS.daily },
  { value: 'weekly', label: RECURRENCE_LABELS.weekly },
  { value: 'monthly', label: RECURRENCE_LABELS.monthly },
  { value: 'seasonal', label: RECURRENCE_LABELS.seasonal },
  { value: 'half_year', label: RECURRENCE_LABELS.half_year },
  { value: 'yearly', label: RECURRENCE_LABELS.yearly }
];

const WEEKDAY_LABELS = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag'
];

const MONTH_LABELS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
];

const WEEK_OF_MONTH_OPTIONS = [
  { value: '1', label: '1.' },
  { value: '2', label: '2.' },
  { value: '3', label: '3.' },
  { value: '4', label: '4.' },
  { value: '-1', label: 'Letzter' }
];

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function App() {
  const [session, setSession] = useState(loadSession());
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [lists, setLists] = useState([]);
  const [view, setView] = useState('today');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [pushStatus, setPushStatus] = useState(null);
  const [pushDiag, setPushDiag] = useState(null);
  const [activeTask, setActiveTask] = useState(null);
  const [dataNotice, setDataNotice] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [createRecurrence, setCreateRecurrence] = useState('weekly');
  const [createRecurrenceMode, setCreateRecurrenceMode] = useState('by_date');
  const [createWeekOfMonth, setCreateWeekOfMonth] = useState('1');
  const [createWeekday, setCreateWeekday] = useState('1');
  const [createMonth, setCreateMonth] = useState(String(DateTime.now().month));
  const [createDueDate, setCreateDueDate] = useState(todayISO());

  const today = todayISO();
  const week = weekRange(today);

  useEffect(() => {
    if (!session) return;
    refreshAll();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refreshPushStatus();
  }, [session]);

  useEffect(() => {
    document.body.classList.toggle('logged-in', !!session);
    return () => {
      document.body.classList.remove('logged-in');
    };
  }, [session]);

  const currentMember = useMemo(
    () => members.find((member) => member.id === session?.memberId),
    [members, session]
  );

  async function refreshAll() {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const [membersRes, tasksRes, listsRes] = await Promise.all([
        fetchMembers(session.householdId),
        fetchTasks(session.householdId),
        fetchLists(session.householdId)
      ]);
      const fetchedMembers = membersRes.members || [];
      setMembers(fetchedMembers);
      setTasks(tasksRes.tasks);
      setLists(listsRes.lists);
      if (session) {
        const hasCurrent = fetchedMembers.some((member) => member.id === session.memberId);
        if (!hasCurrent && session.memberName) {
          const match = fetchedMembers.find(
            (member) =>
              member.name &&
              member.name.toLowerCase() === String(session.memberName).toLowerCase()
          );
          if (match) {
            const newSession = {
              ...session,
              memberId: match.id,
              memberName: match.name
            };
            saveSession(newSession);
            setSession(newSession);
            setError('Dein Mitglied wurde aktualisiert.');
          } else {
            setError('Dein Mitglied wurde nicht gefunden. Bitte „Neu verbinden“.');
          }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshPushStatus() {
    if (!session) return;
    try {
      const status = await fetchPushStatus(session.memberId);
      setPushStatus(status);
    } catch (_) {
      setPushStatus(null);
    }
  }

  async function handlePushDiagnostics() {
    setNotice('');
    setPushDiag(null);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const hasSW = 'serviceWorker' in navigator;
    const hasPush = 'PushManager' in window;
    const permission = 'Notification' in window ? Notification.permission : 'unsupported';

    let publicKeyStatus = 'unbekannt';
    try {
      const { publicKey } = await fetchPushPublicKey();
      publicKeyStatus = publicKey ? 'vorhanden' : 'fehlt';
    } catch (_) {
      publicKeyStatus = 'fehler';
    }

    let swReady = false;
    let hasSubscription = false;
    if (hasSW) {
      try {
        const reg = await navigator.serviceWorker.ready;
        swReady = Boolean(reg);
        if (reg) {
          const existing = await reg.pushManager.getSubscription();
          hasSubscription = Boolean(existing);
        }
      } catch (_) {
        swReady = false;
      }
    }

    let server = null;
    if (session) {
      try {
        server = await fetchPushStatus(session.memberId);
        setPushStatus(server);
      } catch (_) {
        server = null;
      }
    }

    setPushDiag({
      isStandalone,
      hasSW,
      hasPush,
      permission,
      publicKeyStatus,
      swReady,
      hasSubscription,
      server
    });
  }

  async function handleJoin(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    const formData = new FormData(event.target);
    const payload = {
      accessCode: formData.get('accessCode').trim(),
      householdName: formData.get('householdName').trim(),
      memberName: formData.get('memberName').trim(),
      timezone: TZ,
      locale: LOCALE
    };

    try {
      const res = await joinHousehold(payload);
      const newSession = {
        householdId: res.household.id,
        householdName: res.household.name,
        accessCode: res.household.access_code,
        memberId: res.member.id,
        memberName: res.member.name
      };
      saveSession(newSession);
      setSession(newSession);
      await refreshPushStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    clearSession();
    setSession(null);
    setMembers([]);
    setTasks([]);
    setLists([]);
    setPushStatus(null);
  }

  async function handleReconnect() {
    if (!session) return;
    setDataNotice('');
    try {
      const res = await joinHousehold({
        accessCode: session.accessCode,
        householdName: '',
        memberName: session.memberName,
        timezone: TZ,
        locale: LOCALE
      });
      const newSession = {
        householdId: res.household.id,
        householdName: res.household.name,
        accessCode: res.household.access_code,
        memberId: res.member.id,
        memberName: res.member.name
      };
      saveSession(newSession);
      setSession(newSession);
      setDataNotice('Neu verbunden. Daten werden geladen.');
      await refreshAll();
      await refreshPushStatus();
    } catch (err) {
      setDataNotice(err.message);
    }
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    if (!session) return;

    const formData = new FormData(event.target);
    const dueDate = createDueDate || formData.get('dueDate');
    const payload = {
      title: formData.get('title').trim(),
      notes: formData.get('notes').trim(),
      recurrence: createRecurrence,
      dueDate,
      primaryMemberId: formData.get('primaryMemberId') || null,
      secondaryMemberId: formData.get('secondaryMemberId') || null,
      recurrenceRule: buildRecurrenceRule(
        createRecurrence,
        createRecurrenceMode,
        createWeekOfMonth,
        createWeekday,
        createMonth,
        dueDate
      )
    };

    try {
      const res = await createTask(session.householdId, payload);
      setTasks((prev) => [...prev, res.task].sort((a, b) => a.due_date.localeCompare(b.due_date)));
      event.target.reset();
      setCreateRecurrence('weekly');
      setCreateRecurrenceMode('by_date');
      setCreateWeekOfMonth('1');
      setCreateWeekday('1');
      setCreateMonth(String(DateTime.now().month));
      setCreateDueDate(todayISO());
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCompleteTask(taskId) {
    if (!session) return;
    try {
      const res = await completeTask(taskId, {
        completedByMemberId: session.memberId,
        completedAt: today
      });

      if (res.task.active === 0) {
        setTasks((prev) => prev.filter((task) => task.id !== taskId));
      } else {
        setTasks((prev) => prev.map((task) => (task.id === taskId ? res.task : task)));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  function startEditTask(task) {
    const rule = parseRecurrenceRuleValue(task.recurrence_rule);
    const dueDate = task.due_date;
    const due = DateTime.fromISO(dueDate);
    setEditDraft({
      id: task.id,
      title: task.title,
      notes: task.notes || '',
      recurrence: task.recurrence,
      dueDate,
      primaryMemberId: task.primary_member_id || '',
      secondaryMemberId: task.secondary_member_id || '',
      recurrenceMode: rule?.mode || 'by_date',
      weekOfMonth: String(rule?.weekOfMonth ?? '1'),
      weekday: String(rule?.weekday ?? String(due.weekday)),
      month: String(rule?.month || rule?.startMonth || due.month)
    });
    setIsEditing(true);
    setActiveTask(task);
    setActionNotice('');
  }

  async function handleSaveEdit() {
    if (!editDraft) return;
    setActionNotice('');
    try {
      const payload = {
        title: editDraft.title.trim(),
        notes: editDraft.notes.trim(),
        recurrence: editDraft.recurrence,
        dueDate: editDraft.dueDate,
        primaryMemberId: editDraft.primaryMemberId || null,
        secondaryMemberId: editDraft.secondaryMemberId || null,
        recurrenceRule: buildRecurrenceRule(
          editDraft.recurrence,
          editDraft.recurrenceMode,
          editDraft.weekOfMonth,
          editDraft.weekday,
          editDraft.month,
          editDraft.dueDate
        )
      };
      const res = await updateTask(editDraft.id, payload);
      setTasks((prev) => prev.map((task) => (task.id === editDraft.id ? res.task : task)));
      setActiveTask(res.task);
      setIsEditing(false);
      setEditDraft(null);
      setActionNotice('Aufgabe gespeichert.');
    } catch (err) {
      setActionNotice(err.message);
    }
  }

  async function handleDeleteTask(taskId) {
    if (!session) return;
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddMember(event) {
    event.preventDefault();
    if (!session) return;
    const formData = new FormData(event.target);
    const name = formData.get('memberName').trim();
    if (!name) return;

    try {
      const res = await addMember(session.householdId, { name });
      setMembers((prev) => [...prev, res.member].sort((a, b) => a.name.localeCompare(b.name)));
      event.target.reset();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteMember(memberId) {
    if (!session) return;
    try {
      await deleteMember(memberId);
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      setTasks((prev) =>
        prev.map((task) => {
          if (task.primary_member_id === memberId) {
            return { ...task, primary_member_id: null };
          }
          if (task.secondary_member_id === memberId) {
            return { ...task, secondary_member_id: null };
          }
          return task;
        })
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResetColors() {
    if (!session) return;
    try {
      const res = await resetMemberColors(session.householdId);
      setMembers(res.members);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateList(event) {
    event.preventDefault();
    if (!session) return;
    const formData = new FormData(event.target);
    const title = formData.get('title').trim();
    if (!title) return;

    try {
      const res = await createList(session.householdId, { title });
      setLists((prev) => [...prev, res.list]);
      event.target.reset();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateListItem(event, listId) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const text = formData.get('text').trim();
    if (!text) return;

    try {
      const res = await createListItem(listId, { text });
      setLists((prev) =>
        prev.map((list) =>
          list.id === listId ? { ...list, items: [...list.items, res.item] } : list
        )
      );
      event.target.reset();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleListItem(itemId, listId, done) {
    try {
      const res = await updateListItem(itemId, { done: done ? 0 : 1 });
      setLists((prev) =>
        prev.map((list) => {
          if (list.id !== listId) return list;
          return {
            ...list,
            items: list.items.map((item) => (item.id === itemId ? res.item : item))
          };
        })
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteListItem(itemId, listId) {
    try {
      await deleteListItem(itemId);
      setLists((prev) =>
        prev.map((list) => {
          if (list.id !== listId) return list;
          return {
            ...list,
            items: list.items.filter((item) => item.id !== itemId)
          };
        })
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteList(listId) {
    try {
      await deleteList(listId);
      setLists((prev) => prev.filter((list) => list.id !== listId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleEnablePush() {
    setNotice('');
    if (!session) return;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotice(
        isStandalone
          ? 'Push wird von diesem Gerät nicht unterstützt.'
          : 'Push funktioniert nur in der installierten App. Bitte über „Zum Home-Bildschirm“ installieren.'
      );
      return;
    }

    try {
      if ('Notification' in window && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setNotice(
            'Bitte Mitteilungen für „Familienplan“ erlauben. iPhone: Einstellungen → Mitteilungen → Familienplan.'
          );
          return;
        }
      }

      const { publicKey } = await fetchPushPublicKey();
      if (!publicKey) {
        setNotice('Push ist auf dem Server noch nicht konfiguriert.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        try {
          await existing.unsubscribe();
        } catch (_) {
          // ignore and resubscribe
        }
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await savePushSubscription(session.memberId, subscription);
      const result = await sendPushTest(session.memberId);
      await refreshPushStatus();
      if (!result.configured) {
        setNotice('Push ist auf dem Server noch nicht konfiguriert.');
      } else if (result.sent > 0) {
        setNotice('Push-Benachrichtigungen sind aktiviert.');
      } else if (result.failed > 0) {
        const errorCode = result.errors?.[0]?.statusCode;
        const errorSuffix = errorCode ? ` (Fehler ${errorCode})` : '';
        setNotice(
          `Push konnte nicht zugestellt werden. Bitte iOS-Mitteilungen prüfen. (Geräte: ${
            result.subscriptions || 0
          })${errorSuffix}`
        );
      } else {
        setNotice('Keine Push-Geräte gefunden. Bitte App neu öffnen und erneut aktivieren.');
      }
    } catch (err) {
      const name = err?.name ? ` (${err.name})` : '';
      const message = err?.message ? ` ${err.message}` : '';
      if (err?.name === 'NotAllowedError') {
        setNotice(
          'Push blockiert: Bitte Mitteilungen erlauben. iPhone: Einstellungen → Mitteilungen → Familienplan.'
        );
      } else if (err?.name === 'InvalidStateError') {
        setNotice('Push nur in der installierten App. Bitte vom Home-Bildschirm öffnen.');
      } else {
        setNotice(`Push konnte nicht aktiviert werden.${name}${message}`.trim());
      }
    }
  }

  async function handleExport() {
    if (!session) return;
    setDataNotice('');
    try {
      const data = await exportHousehold(session.accessCode);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `familienplan-${session.accessCode}-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDataNotice('Export erstellt.');
    } catch (err) {
      setDataNotice(err.message);
    }
  }

  async function handleImport() {
    if (!session || !importFile) return;
    setDataNotice('');
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      await importHousehold(session.accessCode, data, 'replace');
      setDataNotice('Daten importiert. Seite wird aktualisiert.');
      setImportFile(null);
      await refreshAll();
    } catch (err) {
      setDataNotice(err.message);
    }
  }

  async function handleTransferTask(task, options = {}) {
    if (!session) return;
    setActionNotice('');
    try {
      const res = await transferTask(task.id, { fromMemberId: session.memberId });
      setTasks((prev) => prev.map((item) => (item.id === task.id ? res.task : item)));
      if (options.openModal) {
        setActiveTask(res.task);
      }
      if (res.push?.sent > 0) {
        setActionNotice('Aufgabe wurde übertragen und die Person wurde informiert.');
      } else if (res.push?.configured === false) {
        setActionNotice('Aufgabe übertragen, aber Push ist nicht konfiguriert.');
      } else if (res.push?.failed > 0) {
        setActionNotice('Aufgabe übertragen, aber Push konnte nicht zugestellt werden.');
      } else {
        setActionNotice('Aufgabe wurde übertragen.');
      }
    } catch (err) {
      setActionNotice(err.message);
    }
  }

  async function handleNudgeTask(task) {
    if (!session) return;
    setActionNotice('');
    try {
      const res = await nudgeTask(task.id, { fromMemberId: session.memberId });
      if (res.sent > 0) {
        setActionNotice('Erinnerung wurde gesendet.');
      } else if (res.configured === false) {
        setActionNotice('Push ist nicht konfiguriert.');
      } else if (res.failed > 0) {
        setActionNotice('Push konnte nicht zugestellt werden.');
      } else {
        setActionNotice('Keine Push-Geräte gefunden.');
      }
    } catch (err) {
      setActionNotice(err.message);
    }
  }

  const tasksDueToday = tasks.filter((task) => task.due_date <= today);
  const tasksDueThisWeek = tasks.filter((task) => isInWeek(task.due_date, week));

  const tasksByMember = members.map((member) => ({
    member,
    tasks: tasksDueToday.filter(
      (task) => task.primary_member_id === member.id || task.secondary_member_id === member.id
    )
  }));

  const unassignedTasks = tasksDueToday.filter(
    (task) => !task.primary_member_id && !task.secondary_member_id
  );

  const myTasksToday = session
    ? tasksDueToday.filter(
        (task) =>
          task.primary_member_id === session.memberId || task.secondary_member_id === session.memberId
      )
    : tasksDueToday;

  const otherMembers = session
    ? members.filter((member) => member.id !== session.memberId)
    : members;
  const tasksByOtherMembers = otherMembers.map((member) => ({
    member,
    tasks: tasksDueToday.filter(
      (task) => task.primary_member_id === member.id || task.secondary_member_id === member.id
    )
  }));

  const createMonthBased = ['monthly', 'seasonal', 'half_year', 'yearly'].includes(
    createRecurrence
  );
  const createShowMonth = ['seasonal', 'half_year', 'yearly'].includes(createRecurrence);
  const createShowWeekday = createMonthBased && createRecurrenceMode === 'by_weekday';
  const editMonthBased =
    editDraft && ['monthly', 'seasonal', 'half_year', 'yearly'].includes(editDraft.recurrence);
  const editShowMonth =
    editDraft &&
    ['seasonal', 'half_year', 'yearly'].includes(editDraft.recurrence);
  const editShowWeekday = editMonthBased && editDraft?.recurrenceMode === 'by_weekday';

  const onlySelf =
    session &&
    members.length === 1 &&
    members[0]?.id === session.memberId;

  if (!session) {
    return (
      <div className="login">
        <h1>Familienplan</h1>
        <p className="notice">
          Aufgaben, Listen und Erinnerungen für eure Familie. Erstes Einrichten dauert nur 2 Minuten.
        </p>
        <form className="form" onSubmit={handleJoin}>
          <div className="field">
            <label>Zugangscode</label>
            <input name="accessCode" placeholder="z.B. 2468" required />
          </div>
          <div className="field">
            <label>Familienname (nur beim ersten Mal)</label>
            <input name="householdName" placeholder="Familie Muster" />
          </div>
          <div className="field">
            <label>Dein Name</label>
            <input name="memberName" placeholder="Sophie" required />
          </div>
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Bitte warten...' : 'Beitreten'}
          </button>
        </form>
        {error && <p className="notice">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>{session.householdName}</h1>
          <span>{formatDate(today)}</span>
          {currentMember && (
            <span>
              Angemeldet als <strong>{currentMember.name}</strong>
            </span>
          )}
        </div>
        <div className="tabs">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              className={`tab ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button className="tab" onClick={handleLogout}>
            Abmelden
          </button>
        </div>
      </header>

      {loading && <p className="notice">Lade Daten...</p>}
      {error && <p className="notice">{error}</p>}

      {view === 'today' && (
        <div className="section hero hero-clear">
          <div className="hero-header">
            <div>
              <h2>
                {getGreeting()} {currentMember ? `, ${currentMember.name}` : ''}
              </h2>
              <p className="notice">Heute stehen {myTasksToday.length} Aufgaben an.</p>
            </div>
          </div>
          {myTasksToday.length === 0 && <p className="notice">Für heute ist alles erledigt.</p>}
          {myTasksToday.length > 0 && (
            <div className="bubble-cloud">
              {myTasksToday.map((task, index) => {
                const bubble = getBubbleStyle(task, index, today);
                const assigned = getPrimaryName(task, members);
                return (
                  <button
                    key={task.id}
                    className="bubble"
                    style={bubble}
                    onClick={() => {
                      setActiveTask(task);
                      setActionNotice('');
                    }}
                  >
                    <span className="bubble-title">{task.title}</span>
                    {assigned && <span className="bubble-meta">{assigned}</span>}
                    {task.transferred_from_member_id && (
                      <span className="bubble-meta">
                        Übertragen von {getTransferredFromName(task, members)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {unassignedTasks.length > 0 && (
            <p className="notice">Ohne Zuordnung: {unassignedTasks.length} Aufgaben.</p>
          )}
        </div>
      )}

      {view === 'family' && (
        <div className="section">
          <h2>Familie – Heute</h2>
          {actionNotice && <p className="notice">{actionNotice}</p>}
          <div className="grid">
            {tasksByOtherMembers.map(({ member, tasks }) => (
              <div className="card" key={member.id}>
                <h3>
                  <span className="badge" style={{ background: member.color || '#ddd' }}>
                    {member.name}
                  </span>
                </h3>
                {tasks.length === 0 && <p className="notice">Keine Aufgaben fällig.</p>}
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    members={members}
                    onComplete={handleCompleteTask}
                    onDelete={handleDeleteTask}
                    onNudge={() => handleNudgeTask(task)}
                    onTransfer={() => handleTransferTask(task)}
                  />
                ))}
              </div>
            ))}
            <div className="card">
              <h3>Ohne Zuordnung</h3>
              {unassignedTasks.length === 0 && <p className="notice">Alles zugewiesen.</p>}
              {unassignedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  members={members}
                  onComplete={handleCompleteTask}
                  onDelete={handleDeleteTask}
                  onNudge={() => handleNudgeTask(task)}
                  onTransfer={() => handleTransferTask(task)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'week' && (
        <div className="section">
          <h2>Diese Woche</h2>
          <p className="notice">
            {formatDateShort(week.start)} – {formatDateShort(week.end)}
          </p>
          {tasksDueThisWeek.length === 0 && <p className="notice">Keine Aufgaben diese Woche.</p>}
          {tasksDueThisWeek.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              members={members}
              onComplete={handleCompleteTask}
              onDelete={handleDeleteTask}
            />
          ))}
        </div>
      )}

      {view === 'tasks' && (
        <div className="section">
          <h2>Alle Aufgaben</h2>
          <div className="grid">
            <div className="card">
              <h3>Neue Aufgabe</h3>
              <form className="form" onSubmit={handleCreateTask}>
                <div className="field">
                  <label>Titel</label>
                  <input name="title" required placeholder="Bad putzen" />
                </div>
                <div className="field">
                  <label>Fällig am</label>
                  <input
                    name="dueDate"
                    type="date"
                    value={createDueDate}
                    onChange={(event) => setCreateDueDate(event.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Wiederholung</label>
                  <select
                    name="recurrence"
                    value={createRecurrence}
                    onChange={(event) => setCreateRecurrence(event.target.value)}
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {createMonthBased && (
                  <div className="field">
                    <label>Wiederholungstyp</label>
                    <select
                      value={createRecurrenceMode}
                      onChange={(event) => setCreateRecurrenceMode(event.target.value)}
                    >
                      <option value="by_date">Gleiches Datum im Monat</option>
                      <option value="by_weekday">Wochentag im Monat (z.B. 1. Montag)</option>
                    </select>
                  </div>
                )}
                {createShowWeekday && (
                  <div className="field">
                    <label>Wochentag</label>
                    <div className="row">
                      <select
                        value={createWeekOfMonth}
                        onChange={(event) => setCreateWeekOfMonth(event.target.value)}
                      >
                        {WEEK_OF_MONTH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={createWeekday}
                        onChange={(event) => setCreateWeekday(event.target.value)}
                      >
                        {WEEKDAY_LABELS.map((label, index) => (
                          <option key={label} value={index + 1}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {createShowMonth && (
                  <div className="field">
                    <label>{createRecurrence === 'yearly' ? 'Monat' : 'Startmonat'}</label>
                    <select
                      value={createMonth}
                      onChange={(event) => setCreateMonth(event.target.value)}
                    >
                      {MONTH_LABELS.map((label, index) => (
                        <option key={label} value={index + 1}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>Hauptperson</label>
                  <select name="primaryMemberId" defaultValue="">
                    <option value="">Keine</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Zweitperson</label>
                  <select name="secondaryMemberId" defaultValue="">
                    <option value="">Keine</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Notiz</label>
                  <textarea name="notes" rows="2" placeholder="Was muss beachtet werden?" />
                </div>
                <button className="button" type="submit">
                  Aufgabe anlegen
                </button>
              </form>
            </div>
            <div className="card">
              <h3>Übersicht</h3>
              {tasks.length === 0 && <p className="notice">Noch keine Aufgaben erstellt.</p>}
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  members={members}
                  onComplete={handleCompleteTask}
                  onDelete={handleDeleteTask}
                  onEdit={() => startEditTask(task)}
                  showNotes
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'lists' && (
        <div className="section">
          <h2>Listen</h2>
          <div className="grid">
            <div className="card">
              <h3>Neue Liste</h3>
              <form className="form" onSubmit={handleCreateList}>
                <div className="field">
                  <label>Name</label>
                  <input name="title" placeholder="Einkauf" required />
                </div>
                <button className="button" type="submit">
                  Liste erstellen
                </button>
              </form>
            </div>
            {lists.map((list) => (
              <div className="card" key={list.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3>{list.title}</h3>
                  <button className="button ghost" onClick={() => handleDeleteList(list.id)}>
                    Entfernen
                  </button>
                </div>
                {list.items.length === 0 && <p className="notice">Noch keine Einträge.</p>}
                {list.items.map((item) => (
                  <div key={item.id} className="list-item">
                    <div className="row">
                      <button
                        className={`check ${item.done ? 'done' : ''}`}
                        onClick={() => toggleListItem(item.id, list.id, item.done)}
                      >
                        {item.done ? '✓' : ''}
                      </button>
                      <span style={{ textDecoration: item.done ? 'line-through' : 'none' }}>
                        {item.text}
                      </span>
                    </div>
                    <button
                      className="button ghost"
                      onClick={() => handleDeleteListItem(item.id, list.id)}
                    >
                      Löschen
                    </button>
                  </div>
                ))}
                <form className="form" onSubmit={(event) => handleCreateListItem(event, list.id)}>
                  <div className="field">
                    <label>Neuer Eintrag</label>
                    <input name="text" placeholder="Milch" />
                  </div>
                  <button className="button secondary" type="submit">
                    Hinzufügen
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'settings' && (
        <div className="section">
          <h2>Einstellungen</h2>
          <div className="grid">
            <div className="card">
              <h3>Mitglieder</h3>
              {onlySelf && (
                <p className="notice">
                  Der Server zeigt nur 1 Mitglied. Falls das falsch ist: Daten importieren oder
                  „Neu verbinden“ drücken.
                </p>
              )}
              {members.map((member) => (
                <div className="row" key={member.id} style={{ justifyContent: 'space-between' }}>
                  <span className="badge" style={{ background: member.color || '#ddd' }}>
                    {member.name}
                  </span>
                  {member.id !== session.memberId && (
                    <button className="button ghost" onClick={() => handleDeleteMember(member.id)}>
                      Entfernen
                    </button>
                  )}
                </div>
              ))}
              <button className="button secondary" onClick={handleResetColors}>
                Pastellfarben neu setzen
              </button>
              <form className="form" onSubmit={handleAddMember}>
                <div className="field">
                  <label>Neues Mitglied</label>
                  <input name="memberName" placeholder="Name" />
                </div>
                <button className="button secondary" type="submit">
                  Hinzufügen
                </button>
              </form>
              <button className="button ghost" onClick={handleReconnect}>
                Neu verbinden
              </button>
            </div>
            <div className="card">
              <h3>Push-Benachrichtigungen</h3>
              <p className="notice">
                Push funktioniert nur in der installierten App (Home-Bildschirm). Tägliche
                Erinnerungen werden um 07:00 Uhr gesendet.
              </p>
              <button className="button" onClick={handleEnablePush}>
                Push aktivieren
              </button>
              <button className="button ghost" onClick={handlePushDiagnostics}>
                Push Diagnose
              </button>
              {pushStatus && (
                <p className="notice">
                  Server gespeichert: {pushStatus.subscriptions} Gerät(e){' '}
                  {pushStatus.configured ? '' : '(Server nicht konfiguriert)'}
                </p>
              )}
              {pushDiag && (
                <div className="notice">
                  <div>Installiert: {pushDiag.isStandalone ? 'ja' : 'nein'}</div>
                  <div>Service Worker: {pushDiag.hasSW ? 'ja' : 'nein'}</div>
                  <div>Push API: {pushDiag.hasPush ? 'ja' : 'nein'}</div>
                  <div>Mitteilungen: {pushDiag.permission}</div>
                  <div>Server-Key: {pushDiag.publicKeyStatus}</div>
                  <div>SW bereit: {pushDiag.swReady ? 'ja' : 'nein'}</div>
                  <div>Lokales Abo: {pushDiag.hasSubscription ? 'ja' : 'nein'}</div>
                  <div>
                    Server-Abo:{' '}
                    {pushDiag.server ? `${pushDiag.server.subscriptions} Gerät(e)` : 'unbekannt'}
                  </div>
                </div>
              )}
              {notice && <p className="notice">{notice}</p>}
            </div>
            <div className="card">
              <h3>Daten übertragen</h3>
              <p className="notice">
                Exportiere Daten vom alten Gerät (lokal) und importiere sie hier in die Cloud.
                Beim Import werden die Cloud-Daten ersetzt.
              </p>
              <div className="row">
                <button className="button secondary" onClick={handleExport}>
                  Export erstellen
                </button>
              </div>
              <div className="field" style={{ marginTop: '12px' }}>
                <label>Import-Datei wählen (.json)</label>
                <input
                  type="file"
                  accept="application/json"
                  onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                />
              </div>
              <button className="button" onClick={handleImport} disabled={!importFile}>
                Importieren
              </button>
              {dataNotice && <p className="notice">{dataNotice}</p>}
            </div>
            <div className="card">
              <h3>Haushalt</h3>
              <p className="notice">
                Zugangscode: <strong>{session.accessCode}</strong>
              </p>
              <p className="notice">Timezone: {TZ}</p>
            </div>
          </div>
        </div>
      )}

      {activeTask && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setActiveTask(null);
            setActionNotice('');
            setIsEditing(false);
            setEditDraft(null);
          }}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{activeTask.title}</h3>
              <button
                className="button ghost"
                onClick={() => {
                  setActiveTask(null);
                  setIsEditing(false);
                  setEditDraft(null);
                }}
              >
                Schließen
              </button>
            </div>
            {isEditing && editDraft ? (
              <div className="form">
                <div className="field">
                  <label>Titel</label>
                  <input
                    value={editDraft.title}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, title: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Fällig am</label>
                  <input
                    type="date"
                    value={editDraft.dueDate}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, dueDate: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Wiederholung</label>
                  <select
                    value={editDraft.recurrence}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, recurrence: event.target.value }))
                    }
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {editMonthBased && (
                  <div className="field">
                    <label>Wiederholungstyp</label>
                    <select
                      value={editDraft.recurrenceMode}
                      onChange={(event) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          recurrenceMode: event.target.value
                        }))
                      }
                    >
                      <option value="by_date">Gleiches Datum im Monat</option>
                      <option value="by_weekday">Wochentag im Monat (z.B. 1. Montag)</option>
                    </select>
                  </div>
                )}
                {editShowWeekday && (
                  <div className="field">
                    <label>Wochentag</label>
                    <div className="row">
                      <select
                        value={editDraft.weekOfMonth}
                        onChange={(event) =>
                          setEditDraft((prev) => ({
                            ...prev,
                            weekOfMonth: event.target.value
                          }))
                        }
                      >
                        {WEEK_OF_MONTH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={editDraft.weekday}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, weekday: event.target.value }))
                        }
                      >
                        {WEEKDAY_LABELS.map((label, index) => (
                          <option key={label} value={index + 1}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {editShowMonth && (
                  <div className="field">
                    <label>{editDraft.recurrence === 'yearly' ? 'Monat' : 'Startmonat'}</label>
                    <select
                      value={editDraft.month}
                      onChange={(event) =>
                        setEditDraft((prev) => ({ ...prev, month: event.target.value }))
                      }
                    >
                      {MONTH_LABELS.map((label, index) => (
                        <option key={label} value={index + 1}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>Hauptperson</label>
                  <select
                    value={editDraft.primaryMemberId}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        primaryMemberId: event.target.value
                      }))
                    }
                  >
                    <option value="">Keine</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Zweitperson</label>
                  <select
                    value={editDraft.secondaryMemberId}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        secondaryMemberId: event.target.value
                      }))
                    }
                  >
                    <option value="">Keine</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Notiz</label>
                  <textarea
                    rows="2"
                    value={editDraft.notes}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, notes: event.target.value }))
                    }
                  />
                </div>
                <div className="modal-actions">
                  <button className="button" onClick={handleSaveEdit}>
                    Speichern
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setEditDraft(null);
                    }}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="modal-meta">
                  {formatRecurrenceLabel(activeTask)} · fällig am{' '}
                  {formatDate(activeTask.due_date)}
                </p>
                <p className="modal-meta">
                  Zuständig: {getAssignedNames(activeTask, members) || 'Offen'}
                </p>
                {activeTask.notes && <p className="modal-notes">{activeTask.notes}</p>}
                <div className="modal-actions">
                  <button className="button" onClick={() => handleCompleteTask(activeTask.id)}>
                    Erledigt
                  </button>
                  <button className="button secondary" onClick={() => handleNudgeTask(activeTask)}>
                    Anstupsen
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => handleTransferTask(activeTask, { openModal: true })}
                    disabled={!activeTask.secondary_member_id}
                    title={
                      activeTask.secondary_member_id
                        ? 'An Zweitperson übertragen'
                        : 'Keine Zweitperson hinterlegt'
                    }
                  >
                    An Zweitperson übertragen
                  </button>
                  <button className="button secondary" onClick={() => startEditTask(activeTask)}>
                    Bearbeiten
                  </button>
                </div>
              </>
            )}
            {actionNotice && <p className="notice">{actionNotice}</p>}
          </div>
        </div>
      )}

      <footer>Minimalistischer Familienplan · Erstellt für eure Familie</footer>
    </div>
  );
}

function TaskRow({
  task,
  members,
  onComplete,
  onDelete,
  onNudge,
  onTransfer,
  onEdit,
  showNotes
}) {
  const memberNames = members
    .filter((member) => member.id === task.primary_member_id || member.id === task.secondary_member_id)
    .map((member) => member.name)
    .join(' & ');

  const overdue = isOverdue(task.due_date);
  const dueLabel = isToday(task.due_date) ? 'Heute' : formatDateShort(task.due_date);

  return (
    <div className="task">
      <div className="task-title">
        <strong>{task.title}</strong>
        <span className="task-meta">
          {formatRecurrenceLabel(task)} · {dueLabel}
          {memberNames ? ` · ${memberNames}` : ''}
        </span>
        {showNotes && task.notes && <span className="task-meta">{task.notes}</span>}
      </div>
      <div className="row">
        <span className={`badge ${overdue ? 'overdue' : ''}`}>
          {overdue ? 'Überfällig' : 'Fällig'}
        </span>
        <button className="button secondary" onClick={() => onComplete(task.id)}>
          Erledigt
        </button>
        {onNudge && (
          <button className="button secondary" onClick={onNudge}>
            Anstupsen
          </button>
        )}
        {onTransfer && (
          <button
            className="button secondary"
            onClick={onTransfer}
            disabled={!task.secondary_member_id}
          >
            Übertragen
          </button>
        )}
        {onEdit && (
          <button className="button secondary" onClick={onEdit}>
            Bearbeiten
          </button>
        )}
        <button className="button ghost" onClick={() => onDelete(task.id)}>
          Entfernen
        </button>
      </div>
    </div>
  );
}

function getPrimaryName(task, members) {
  const member = members.find((m) => m.id === task.primary_member_id);
  return member ? member.name : '';
}

function getTransferredFromName(task, members) {
  const member = members.find((m) => m.id === task.transferred_from_member_id);
  return member ? member.name : '';
}

function parseRecurrenceRuleValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function buildRecurrenceRule(recurrence, mode, weekOfMonth, weekday, month, dueDate) {
  const monthBased = ['monthly', 'seasonal', 'half_year', 'yearly'].includes(recurrence);
  if (!monthBased) return null;

  const rule = { mode };
  if (mode === 'by_weekday') {
    rule.weekOfMonth = Number(weekOfMonth || 1);
    rule.weekday = Number(weekday || 1);
  } else if (dueDate) {
    const base = DateTime.fromISO(dueDate);
    rule.day = base.day;
  }

  if (recurrence === 'yearly') {
    rule.month = Number(month || DateTime.fromISO(dueDate || DateTime.now().toISODate()).month);
  } else if (recurrence === 'seasonal' || recurrence === 'half_year') {
    rule.startMonth = Number(month || DateTime.fromISO(dueDate || DateTime.now().toISODate()).month);
  }

  return rule;
}

function formatRecurrenceLabel(task) {
  const base = RECURRENCE_LABELS[task.recurrence] || task.recurrence;
  const rule = parseRecurrenceRuleValue(task.recurrence_rule);
  if (!rule) return base;

  let detail = '';
  if (rule.mode === 'by_weekday' && rule.weekday) {
    const weekOfMonth = Number(rule.weekOfMonth || 1);
    const weekday = Number(rule.weekday || 1);
    const weekLabel = weekOfMonth === -1 ? 'letzter' : `${weekOfMonth}.`;
    const dayLabel = WEEKDAY_LABELS[weekday - 1] || '';
    detail = `${weekLabel} ${dayLabel}`;
  } else if (rule.mode === 'by_date' && rule.day) {
    detail = `am ${Number(rule.day)}.`;
  }

  if (task.recurrence === 'yearly' && rule.month) {
    const month = Number(rule.month);
    detail = detail ? `${detail} im ${MONTH_LABELS[month - 1]}` : base;
  }

  if ((task.recurrence === 'seasonal' || task.recurrence === 'half_year') && rule.startMonth) {
    const startMonth = Number(rule.startMonth);
    detail = detail ? `${detail} ab ${MONTH_LABELS[startMonth - 1]}` : base;
  }

  return detail ? `${base} · ${detail}` : base;
}

function getAssignedNames(task, members) {
  const names = members
    .filter((member) => member.id === task.primary_member_id || member.id === task.secondary_member_id)
    .map((member) => member.name);
  return names.join(' & ');
}

function getGreeting() {
  const hour = DateTime.now().setZone(TZ).hour;
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 17) return 'Guten Tag';
  if (hour < 22) return 'Guten Abend';
  return 'Gute Nacht';
}

function getBubbleStyle(task, index, today) {
  const todayDate = DateTime.fromISO(today, { zone: TZ }).startOf('day');
  const dueDate = DateTime.fromISO(task.due_date, { zone: TZ }).startOf('day');
  const diffDays = Math.floor(dueDate.diff(todayDate, 'days').days);
  const overdueDays = diffDays < 0 ? Math.abs(diffDays) : 0;
  const intensity = Math.min(1, 0.45 + overdueDays * 0.18);
  const size = 100 + intensity * 70;
  const light = 90 - intensity * 25;
  const deep = 80 - intensity * 28;
  const hue = task.transferred_from_member_id ? 262 : 214;
  const delay = (index % 7) * 0.25;
  return {
    width: `${size}px`,
    height: `${size}px`,
    background: `radial-gradient(circle at 30% 30%, hsl(${hue}, 100%, ${light}%), hsl(${hue}, 90%, ${deep}%))`,
    animationDelay: `${delay}s`,
    animationDuration: `${5.5 + (index % 5)}s`
  };
}
