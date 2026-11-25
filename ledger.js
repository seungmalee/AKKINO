(function (root) {
  'use strict';

  var STORAGE_KEY = 'daily-ledger-state-v1';
  var INITIAL_LIMIT = 20000;
  var DEFAULT_CATEGORIES = ['식비', '생필품', '쇼핑', '기타'];
  // A single budget or expense is capped at one trillion won. This keeps
  // normal monthly carry calculations comfortably inside safe integer range.
  var MAX_MONEY = 1000000000000;
  var MAX_SAFE_INTEGER = 9007199254740991;
  var SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
  var idSequence = 0;

  function error(message) {
    throw new Error('가계부: ' + message);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isSafeInteger(value) {
    return typeof value === 'number' && isFinite(value) &&
      Math.floor(value) === value && Math.abs(value) <= MAX_SAFE_INTEGER;
  }

  function assertPositiveInteger(value, label) {
    if (!isSafeInteger(value) || value <= 0) {
      error(label + '은 0보다 큰 안전한 정수여야 합니다.');
    }
    if (value > MAX_MONEY) {
      error(label + '은 1조원 이하로 입력해 주세요.');
    }
  }

  function assertNonNegativeInteger(value, label) {
    if (!isSafeInteger(value) || value < 0) {
      error(label + '은 0 이상인 안전한 정수여야 합니다.');
    }
    if (value > MAX_MONEY) {
      error(label + '은 1조원 이하로 입력해 주세요.');
    }
  }

  function assertNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
      error(label + '을(를) 입력해 주세요.');
    }
  }

  function parseIsoDate(value) {
    var year;
    var month;
    var day;
    var date;

    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    year = Number(value.slice(0, 4));
    month = Number(value.slice(5, 7));
    day = Number(value.slice(8, 10));
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
      return null;
    }
    return date;
  }

  function isIsoDate(value) {
    return parseIsoDate(value) !== null;
  }

  function assertIsoDate(value, label) {
    if (!isIsoDate(value)) {
      error(label + '은 올바른 날짜(YYYY-MM-DD)가 아닙니다.');
    }
  }

  function compareDates(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  function addDays(isoDate, amount) {
    var date = parseIsoDate(isoDate);
    date.setUTCDate(date.getUTCDate() + amount);
    return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  function formatDateParts(year, month, day) {
    return String(year).padStart(4, '0') + '-' +
      String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function today() {
    var now = new Date();
    var seoulTime = new Date(now.getTime() + SEOUL_OFFSET_MS);
    return formatDateParts(
      seoulTime.getUTCFullYear(),
      seoulTime.getUTCMonth() + 1,
      seoulTime.getUTCDate()
    );
  }

  function getStorage() {
    var storage;
    try {
      storage = root && root.localStorage;
      if (storage) return storage;
    } catch (ignore) {
      return null;
    }

    try {
      if (typeof globalThis !== 'undefined' && globalThis !== root) {
        return globalThis.localStorage || null;
      }
    } catch (ignoreGlobal) {
      return null;
    }
    return null;
  }

  function cloneEntry(entry) {
    return {
      id: entry.id,
      date: entry.date,
      category: entry.category,
      amount: entry.amount,
      note: entry.note
    };
  }

  function cloneState(state) {
    var copy = {
      startDate: state.startDate,
      categories: state.categories.slice(),
      entries: state.entries.map(cloneEntry),
      limit: state.limit,
      limitChanges: state.limitChanges.map(function (change) {
        return { date: change.date, limit: change.limit };
      })
    };
    return copy;
  }

  function normalizeId(value) {
    if (typeof value === 'string') {
      if (value.trim() === '') error('거래 ID가 비어 있습니다.');
      return value;
    }
    if (isSafeInteger(value)) return value;
    error('거래 ID가 올바르지 않습니다.');
  }

  function normalizeEntry(raw, startDate) {
    var entry;
    if (!isObject(raw)) error('지출 기록 형식이 올바르지 않습니다.');

    entry = {
      id: normalizeId(raw.id),
      date: raw.date,
      category: raw.category,
      amount: raw.amount,
      note: raw.note == null ? '' : raw.note
    };
    assertIsoDate(entry.date, '지출 날짜');
    if (compareDates(entry.date, startDate) < 0) {
      error('개설일보다 이전 날짜에는 지출을 기록할 수 없습니다.');
    }
    assertNonEmptyString(entry.category, '카테고리');
    assertPositiveInteger(entry.amount, '지출 금액');
    if (typeof entry.note !== 'string') {
      error('메모는 문자열이어야 합니다.');
    }
    return entry;
  }

  function validateExpenseTotals(entries) {
    var totals = Object.create(null);
    var i;
    var entry;
    var total;
    for (i = 0; i < entries.length; i += 1) {
      entry = entries[i];
      total = (totals[entry.date] || 0) + entry.amount;
      if (!isSafeInteger(total)) {
        error('하루 지출 합계가 너무 큽니다.');
      }
      totals[entry.date] = total;
    }
  }

  function readChangeLimit(raw) {
    if (!isObject(raw)) return undefined;
    if (raw.limit != null) return raw.limit;
    if (raw.amount != null) return raw.amount;
    if (raw.value != null) return raw.value;
    return undefined;
  }

  function normalizeLimitChanges(rawChanges, startDate) {
    var changes = [];
    var seen = Object.create(null);
    var i;
    var date;
    var limit;
    var raw;
    var dates;

    if (rawChanges == null) return changes;

    if (Array.isArray(rawChanges)) {
      for (i = 0; i < rawChanges.length; i += 1) {
        raw = rawChanges[i];
        if (!isObject(raw)) error('한도 변경 기록 형식이 올바르지 않습니다.');
        date = raw.date;
        limit = readChangeLimit(raw);
        assertIsoDate(date, '한도 변경 날짜');
        if (compareDates(date, startDate) < 0) {
          error('개설일보다 이전 날짜에는 한도를 설정할 수 없습니다.');
        }
        assertNonNegativeInteger(limit, '한도');
        if (seen[date]) error('같은 날짜의 한도 변경이 중복되었습니다.');
        seen[date] = true;
        changes.push({ date: date, limit: limit });
      }
    } else if (isObject(rawChanges)) {
      dates = Object.keys(rawChanges);
      for (i = 0; i < dates.length; i += 1) {
        date = dates[i];
        limit = rawChanges[date];
        assertIsoDate(date, '한도 변경 날짜');
        if (compareDates(date, startDate) < 0) {
          error('개설일보다 이전 날짜에는 한도를 설정할 수 없습니다.');
        }
        assertNonNegativeInteger(limit, '한도');
        changes.push({ date: date, limit: limit });
      }
    } else {
      error('한도 변경 기록 형식이 올바르지 않습니다.');
    }

    changes.sort(function (left, right) {
      return compareDates(left.date, right.date);
    });
    return changes;
  }

  function normalizeState(rawState) {
    var startDate;
    var categories;
    var entries;
    var changes;
    var baseLimit;
    var sourceChanges;
    var seenIds = Object.create(null);
    var normalizedEntries;
    var i;
    var category;
    var entry;
    var idKey;

    if (!isObject(rawState)) error('가계부 상태 형식이 올바르지 않습니다.');

    startDate = rawState.startDate;
    assertIsoDate(startDate, '개설일');

    categories = rawState.categories;
    if (!Array.isArray(categories)) error('카테고리 목록 형식이 올바르지 않습니다.');
    categories = categories.map(function (value) {
      assertNonEmptyString(value, '카테고리');
      return value;
    });
    for (i = 0; i < categories.length; i += 1) {
      for (var j = i + 1; j < categories.length; j += 1) {
        if (categories[i] === categories[j]) error('카테고리가 중복되었습니다.');
      }
    }

    baseLimit = rawState.limit;
    if (baseLimit == null) baseLimit = rawState.defaultLimit;
    if (baseLimit == null) baseLimit = rawState.baseLimit;
    if (baseLimit == null) baseLimit = INITIAL_LIMIT;
    assertNonNegativeInteger(baseLimit, '기본 한도');

    sourceChanges = rawState.limitChanges;
    if (sourceChanges == null) sourceChanges = rawState.limitHistory;
    if (sourceChanges == null) sourceChanges = rawState.limits;
    changes = normalizeLimitChanges(sourceChanges, startDate);

    entries = rawState.entries;
    if (!Array.isArray(entries)) error('지출 기록 목록 형식이 올바르지 않습니다.');
    normalizedEntries = [];
    for (i = 0; i < entries.length; i += 1) {
      entry = normalizeEntry(entries[i], startDate);
      idKey = String(entry.id);
      if (seenIds[idKey]) error('거래 ID가 중복되었습니다.');
      seenIds[idKey] = true;
      normalizedEntries.push(entry);
    }
    validateExpenseTotals(normalizedEntries);

    return {
      startDate: startDate,
      categories: categories,
      entries: normalizedEntries,
      limit: baseLimit,
      limitChanges: changes
    };
  }

  function createFreshState() {
    return {
      startDate: today(),
      categories: DEFAULT_CATEGORIES.slice(),
      entries: [],
      limit: INITIAL_LIMIT,
      limitChanges: []
    };
  }

  function stateForUse(state) {
    return normalizeState(state);
  }

  function assertAvailableDate(state, isoDate, label) {
    var now = today();
    assertIsoDate(isoDate, label || '날짜');
    if (compareDates(isoDate, state.startDate) < 0) {
      error('개설일보다 이전 날짜는 사용할 수 없습니다.');
    }
    if (compareDates(isoDate, now) > 0) {
      error('오늘 이후 날짜는 사용할 수 없습니다.');
    }
  }

  function effectiveLimit(state, isoDate) {
    var result = state.limit;
    var changes = state.limitChanges;
    var i;
    for (i = 0; i < changes.length; i += 1) {
      if (compareDates(changes[i].date, isoDate) > 0) break;
      result = changes[i].limit;
    }
    return result;
  }

  function expenseTotalsByDate(state) {
    var totals = Object.create(null);
    var i;
    var entry;
    var next;
    for (i = 0; i < state.entries.length; i += 1) {
      entry = state.entries[i];
      next = (totals[entry.date] || 0) + entry.amount;
      if (!isSafeInteger(next)) error('지출 합계가 너무 큽니다.');
      totals[entry.date] = next;
    }
    return totals;
  }

  function calculateDay(state, isoDate) {
    var totals = expenseTotalsByDate(state);
    var monthStart = isoDate.slice(0, 8) + '01';
    var from = compareDates(state.startDate, monthStart) > 0 ? state.startDate : monthStart;
    var cursor = from;
    var carry = 0;
    var dailyLimit;
    var addition;
    var spent;
    var entries;
    var i;

    while (compareDates(cursor, isoDate) < 0) {
      dailyLimit = effectiveLimit(state, cursor);
      addition = dailyLimit - (totals[cursor] || 0);
      if (!isSafeInteger(addition) || !isSafeInteger(carry + addition)) {
        error('이월 금액이 너무 큽니다.');
      }
      carry += addition;
      cursor = addDays(cursor, 1);
    }

    spent = totals[isoDate] || 0;
    if (!isSafeInteger(dailyLimit = effectiveLimit(state, isoDate))) {
      error('한도 값이 너무 큽니다.');
    }
    if (!isSafeInteger(dailyLimit + carry) ||
        !isSafeInteger(dailyLimit + carry - spent)) {
      error('사용 가능 금액이 너무 큽니다.');
    }

    entries = [];
    for (i = state.entries.length - 1; i >= 0; i -= 1) {
      if (state.entries[i].date === isoDate) {
        entries.push(cloneEntry(state.entries[i]));
      }
    }

    return {
      limit: dailyLimit,
      carry: carry,
      spent: spent,
      available: dailyLimit + carry,
      remaining: dailyLimit + carry - spent,
      entries: entries
    };
  }

  function makeId(state) {
    var id;
    var used = Object.create(null);
    var i;
    for (i = 0; i < state.entries.length; i += 1) {
      used[String(state.entries[i].id)] = true;
    }
    do {
      idSequence += 1;
      id = 'e-' + new Date().getTime().toString(36) + '-' +
        idSequence.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    } while (used[id]);
    return id;
  }

  function readStoredState() {
    var storage = getStorage();
    var raw;
    var parsed;
    if (!storage) error('저장 공간에 접근할 수 없습니다.');
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (readError) {
      error('저장된 가계부를 읽을 수 없습니다.');
    }
    if (raw == null || raw === '') {
      return { state: null };
    }
    try {
      parsed = JSON.parse(raw);
      return { state: normalizeState(parsed) };
    } catch (parseError) {
      error('저장된 가계부 데이터가 손상되었습니다.');
    }
  }

  function save(state) {
    var normalized = stateForUse(state);
    var serialized;
    var storage;

    try {
      serialized = JSON.stringify(normalized);
    } catch (serializeError) {
      error('저장할 수 없는 상태입니다.');
    }

    storage = getStorage();
    if (!storage) error('저장 공간에 접근할 수 없습니다.');
    try {
      storage.setItem(STORAGE_KEY, serialized);
    } catch (writeError) {
      error('저장에 실패했습니다.');
    }
  }

  function open() {
    var stored = readStoredState();
    var fresh;

    if (stored.state) {
      return cloneState(stored.state);
    }

    fresh = createFreshState();
    save(fresh);
    return cloneState(fresh);
  }

  function day(state, isoDate) {
    var normalized = stateForUse(state);
    assertAvailableDate(normalized, isoDate, '조회 날짜');
    return calculateDay(normalized, isoDate);
  }

  function setLimit(state, isoDate, amount) {
    var normalized = stateForUse(state);
    var next;
    var changes;
    var replaced = false;

    assertAvailableDate(normalized, isoDate, '한도 날짜');
    assertNonNegativeInteger(amount, '한도');
    changes = normalized.limitChanges.map(function (change) {
      if (change.date === isoDate) {
        replaced = true;
        return { date: isoDate, limit: amount };
      }
      return { date: change.date, limit: change.limit };
    });
    if (!replaced) changes.push({ date: isoDate, limit: amount });
    changes.sort(function (left, right) {
      return compareDates(left.date, right.date);
    });

    next = cloneState(normalized);
    next.limitChanges = changes;
    return next;
  }

  function addCategory(state, name) {
    var normalized = stateForUse(state);
    var trimmed;
    var next;
    assertNonEmptyString(name, '카테고리 이름');
    trimmed = name.trim();
    if (trimmed.length > 100) error('카테고리 이름이 너무 깁니다.');
    if (normalized.categories.indexOf(trimmed) !== -1) {
      error('이미 있는 카테고리입니다.');
    }
    next = cloneState(normalized);
    next.categories.push(trimmed);
    return next;
  }

  function addExpense(state, isoDate, categoryName, amount, note) {
    var normalized = stateForUse(state);
    var next;
    var category;
    var entry;

    assertAvailableDate(normalized, isoDate, '지출 날짜');
    assertNonEmptyString(categoryName, '카테고리');
    category = categoryName.trim();
    if (normalized.categories.indexOf(category) === -1) {
      error('등록되지 않은 카테고리입니다.');
    }
    assertPositiveInteger(amount, '지출 금액');
    if (note == null) note = '';
    if (typeof note !== 'string') error('메모는 문자열이어야 합니다.');

    entry = {
      id: makeId(normalized),
      date: isoDate,
      category: category,
      amount: amount,
      note: note
    };
    next = cloneState(normalized);
    next.entries.push(entry);
    validateExpenseTotals(next.entries);
    return next;
  }

  function updateExpense(state, id, categoryName, amount, note) {
    var normalized = stateForUse(state);
    var next;
    var category;
    var index = -1;
    var i;

    if (id == null || (typeof id === 'string' && id.trim() === '')) {
      error('수정할 거래 ID를 입력해 주세요.');
    }
    for (i = 0; i < normalized.entries.length; i += 1) {
      if (String(normalized.entries[i].id) === String(id)) {
        index = i;
        break;
      }
    }
    if (index === -1) error('수정할 거래를 찾을 수 없습니다.');

    assertNonEmptyString(categoryName, '카테고리');
    category = categoryName.trim();
    if (normalized.categories.indexOf(category) === -1) {
      error('등록되지 않은 카테고리입니다.');
    }
    assertPositiveInteger(amount, '지출 금액');
    if (note == null) note = '';
    if (typeof note !== 'string') error('메모는 문자열이어야 합니다.');

    next = cloneState(normalized);
    next.entries[index] = {
      id: normalized.entries[index].id,
      date: normalized.entries[index].date,
      category: category,
      amount: amount,
      note: note
    };
    validateExpenseTotals(next.entries);
    return next;
  }

  function removeExpense(state, id) {
    var normalized = stateForUse(state);
    var next;
    var index = -1;
    var i;

    if (id == null || (typeof id === 'string' && id.trim() === '')) {
      error('삭제할 거래 ID를 입력해 주세요.');
    }
    for (i = 0; i < normalized.entries.length; i += 1) {
      if (String(normalized.entries[i].id) === String(id)) {
        index = i;
        break;
      }
    }
    if (index === -1) error('삭제할 거래를 찾을 수 없습니다.');
    next = cloneState(normalized);
    next.entries.splice(index, 1);
    return next;
  }

  var Ledger = {
    today: today,
    open: open,
    save: save,
    day: day,
    setLimit: setLimit,
    addCategory: addCategory,
    addExpense: addExpense,
    updateExpense: updateExpense,
    removeExpense: removeExpense
  };

  if (root) root.Ledger = Ledger;
  try {
    if (typeof globalThis !== 'undefined') globalThis.Ledger = Ledger;
  } catch (ignoreGlobalExport) {
    // Some embedded script hosts expose a read-only global object.
  }
})(typeof window !== 'undefined' ? window :
   (typeof globalThis !== 'undefined' ? globalThis : this));
