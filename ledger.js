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
  var MIN_DATE = '2000-01-01';
  var MAX_DATE = '2099-12-31';
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

  function assertResetDay(value, label) {
    if (!isSafeInteger(value) || value < 1 || value > 31) {
      error((label || '초기화 날짜') + '은 1일부터 31일 사이여야 합니다.');
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

  function daysInMonth(year, month) {
    var date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month, 0);
    return date.getUTCDate();
  }

  function monthBoundary(year, month, resetDay) {
    return formatDateParts(
      year,
      month,
      Math.min(resetDay, daysInMonth(year, month)),
    );
  }

  function monthStart(isoDate) {
    return isoDate.slice(0, 8) + '01';
  }

  function nextMonthStart(isoDate) {
    var date = parseIsoDate(monthStart(isoDate));
    date.setUTCMonth(date.getUTCMonth() + 1);
    return formatDateParts(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1,
    );
  }

  function previousMonthStart(isoDate) {
    var date = parseIsoDate(monthStart(isoDate));
    date.setUTCMonth(date.getUTCMonth() - 1);
    return formatDateParts(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1,
    );
  }

  function boundaryOnOrAfter(isoDate, resetDay) {
    var date = parseIsoDate(isoDate);
    var candidate = monthBoundary(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      resetDay,
    );
    if (compareDates(candidate, isoDate) < 0) {
      candidate = nextMonthStart(isoDate);
      date = parseIsoDate(candidate);
      candidate = monthBoundary(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        resetDay,
      );
    }
    return candidate;
  }

  function boundaryOnOrBefore(isoDate, resetDay) {
    var date = parseIsoDate(isoDate);
    var candidate = monthBoundary(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      resetDay,
    );
    if (compareDates(candidate, isoDate) > 0) {
      candidate = previousMonthStart(isoDate);
      date = parseIsoDate(candidate);
      candidate = monthBoundary(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        resetDay,
      );
    }
    return candidate;
  }

  function nextBoundaryAfter(isoDate, resetDay) {
    var candidate = boundaryOnOrAfter(isoDate, resetDay);
    if (compareDates(candidate, isoDate) <= 0) {
      candidate = nextMonthStart(isoDate);
      var date = parseIsoDate(candidate);
      candidate = monthBoundary(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        resetDay,
      );
    }
    return candidate;
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
      }),
      resetDay: state.resetDay,
      resetChanges: state.resetChanges.map(function (change) {
        return {
          configuredOn: change.configuredOn,
          resetDay: change.resetDay,
          cycleStart: change.cycleStart,
        };
      }),
      resetConfigured: state.resetConfigured === true,
      onboardingComplete: state.onboardingComplete === true
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

  function readResetChangeDay(raw) {
    if (!isObject(raw)) return undefined;
    if (raw.resetDay != null) return raw.resetDay;
    if (raw.day != null) return raw.day;
    if (raw.value != null) return raw.value;
    return undefined;
  }

  function normalizeResetChanges(rawChanges, startDate, rawResetDay, rawConfigured) {
    var changes = [];
    var seen = Object.create(null);
    var i;
    var configuredOn;
    var cycleStart;
    var resetDay;
    var raw;
    var dates;

    if (rawChanges == null) {
      if (rawResetDay != null) {
        assertResetDay(rawResetDay);
        return [{
          configuredOn: startDate,
          resetDay: rawResetDay,
          cycleStart: startDate,
        }];
      }
      if (rawConfigured === true) {
        return [{ configuredOn: startDate, resetDay: 1, cycleStart: startDate }];
      }
      return changes;
    }

    if (Array.isArray(rawChanges)) {
      for (i = 0; i < rawChanges.length; i += 1) {
        raw = rawChanges[i];
        if (!isObject(raw)) error('초기화 변경 기록 형식이 올바르지 않습니다.');
        configuredOn = raw.configuredOn;
        if (configuredOn == null) configuredOn = raw.date;
        if (configuredOn == null) configuredOn = raw.effectiveDate;
        resetDay = readResetChangeDay(raw);
        assertIsoDate(configuredOn, '초기화 변경 날짜');
        if (compareDates(configuredOn, startDate) < 0) {
          error('개설일보다 이전 날짜에는 초기화를 설정할 수 없습니다.');
        }
        assertResetDay(resetDay);
        if (seen[configuredOn]) error('같은 날짜의 초기화 변경이 중복되었습니다.');
        seen[configuredOn] = true;
        cycleStart = raw.cycleStart;
        if (cycleStart == null) cycleStart = startDate;
        assertIsoDate(cycleStart, '이월 시작 날짜');
        if (compareDates(cycleStart, startDate) < 0 ||
            compareDates(cycleStart, configuredOn) > 0) {
          error('이월 시작 날짜가 올바르지 않습니다.');
        }
        changes.push({
          configuredOn: configuredOn,
          resetDay: resetDay,
          cycleStart: cycleStart,
        });
      }
    } else if (isObject(rawChanges)) {
      dates = Object.keys(rawChanges);
      for (i = 0; i < dates.length; i += 1) {
        configuredOn = dates[i];
        resetDay = rawChanges[configuredOn];
        assertIsoDate(configuredOn, '초기화 변경 날짜');
        if (compareDates(configuredOn, startDate) < 0) {
          error('개설일보다 이전 날짜에는 초기화를 설정할 수 없습니다.');
        }
        assertResetDay(resetDay);
        changes.push({
          configuredOn: configuredOn,
          resetDay: resetDay,
          cycleStart: startDate,
        });
      }
    } else {
      error('초기화 변경 기록 형식이 올바르지 않습니다.');
    }

    changes.sort(function (left, right) {
      return compareDates(left.configuredOn, right.configuredOn);
    });
    return changes;
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
    var sourceResetChanges;
    var resetChanges;
    var rawResetDay;
    var resetDay;
    var resetConfigured;
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

    rawResetDay = rawState.resetDay;
    if (rawResetDay != null) assertResetDay(rawResetDay);
    sourceResetChanges = rawState.resetChanges;
    if (sourceResetChanges == null) sourceResetChanges = rawState.resetHistory;
    resetChanges = normalizeResetChanges(
      sourceResetChanges,
      startDate,
      rawResetDay,
      rawState.resetConfigured === true,
    );
    // An explicit `resetConfigured: false` wins: cloned/saved states carry a
    // default resetDay of 1 that must not count as a user choice.
    resetConfigured =
      rawState.resetConfigured === true ||
      (rawState.resetConfigured !== false &&
        (rawResetDay != null || resetChanges.length > 0));
    resetDay = resetChanges.length
      ? resetChanges[resetChanges.length - 1].resetDay
      : rawResetDay == null
        ? 1
        : rawResetDay;

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
      limitChanges: changes,
      resetDay: resetDay,
      resetChanges: resetChanges,
      resetConfigured: resetConfigured,
      onboardingComplete: rawState.onboardingComplete === true
    };
  }

  function createFreshState(initialLimit, initialResetDay, onboardingComplete) {
    var limit = initialLimit == null ? INITIAL_LIMIT : initialLimit;
    var startDate = today();
    var resetDay = initialResetDay == null ? 1 : initialResetDay;
    assertNonNegativeInteger(limit, '기본 한도');
    if (initialResetDay != null) assertResetDay(initialResetDay);
    return {
      startDate: startDate,
      categories: DEFAULT_CATEGORIES.slice(),
      entries: [],
      limit: limit,
      limitChanges: [],
      resetDay: resetDay,
      resetChanges:
        initialResetDay == null
          ? []
          : [{
              configuredOn: startDate,
              resetDay: resetDay,
              cycleStart: startDate,
            }],
      resetConfigured: initialResetDay != null,
      onboardingComplete: onboardingComplete === true
    };
  }

  function stateForUse(state) {
    return normalizeState(state);
  }

  function assertAvailableDate(state, isoDate, label) {
    // Any calendar date may be viewed or written; writing before the start
    // date moves the start back (see extendStartDate).
    assertIsoDate(isoDate, label || '날짜');
    if (compareDates(isoDate, MIN_DATE) < 0 || compareDates(isoDate, MAX_DATE) > 0) {
      error('2000년부터 2099년 사이 날짜만 사용할 수 있습니다.');
    }
  }

  // Returns a copy whose ledger starts no later than isoDate. Reset settings
  // that were in place from the old start keep covering the new start.
  function extendStartDate(state, isoDate) {
    var oldStart = state.startDate;
    var next;
    var i;
    var change;
    var previousDay;
    var boundary;
    if (compareDates(isoDate, oldStart) >= 0) return state;
    next = cloneState(state);
    next.startDate = isoDate;
    for (i = 0; i < next.resetChanges.length; i += 1) {
      change = next.resetChanges[i];
      if (change.configuredOn === oldStart && change.cycleStart === oldStart) {
        change.configuredOn = isoDate;
        change.cycleStart = isoDate;
      } else if (change.cycleStart === oldStart) {
        previousDay = i > 0 ? next.resetChanges[i - 1].resetDay : 1;
        boundary = boundaryOnOrBefore(change.configuredOn, previousDay);
        change.cycleStart =
          compareDates(boundary, isoDate) < 0 ? isoDate : boundary;
      }
    }
    return next;
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

  function effectiveResetChange(state, isoDate) {
    var active = null;
    var first = state.resetChanges[0];
    var i;
    for (i = 0; i < state.resetChanges.length; i += 1) {
      if (compareDates(state.resetChanges[i].configuredOn, isoDate) > 0) break;
      active = state.resetChanges[i];
    }
    // A reset day chosen when the ledger started also covers earlier days.
    if (!active && first && compareDates(first.configuredOn, state.startDate) <= 0) {
      active = first;
    }
    return active;
  }

  function effectiveResetDay(state, isoDate) {
    var active = effectiveResetChange(state, isoDate);
    return active ? active.resetDay : 1;
  }

  function cycleStartDate(state, isoDate) {
    var active = effectiveResetChange(state, isoDate);
    var resetDay = active ? active.resetDay : 1;
    var start;
    if (active && compareDates(isoDate, active.configuredOn) >= 0) {
      if (
        compareDates(isoDate, boundaryOnOrAfter(active.configuredOn, resetDay)) <
        0
      )
        start = active.cycleStart;
      else start = boundaryOnOrBefore(isoDate, resetDay);
    } else {
      start = boundaryOnOrBefore(isoDate, resetDay);
    }
    if (compareDates(start, state.startDate) < 0) start = state.startDate;
    return start;
  }

  function resetInfo(state, isoDate) {
    var normalized = stateForUse(state);
    var date = isoDate == null ? today() : isoDate;
    var active;
    var resetDay;
    assertAvailableDate(normalized, date, '조회 날짜');
    active = effectiveResetChange(normalized, date);
    resetDay = effectiveResetDay(normalized, date);
    return {
      resetDay: resetDay,
      configured: normalized.resetConfigured === true,
      configuredOn: active ? active.configuredOn : null,
      cycleStart: cycleStartDate(normalized, date),
      nextReset: nextBoundaryAfter(date, resetDay)
    };
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
    var from = cycleStartDate(state, isoDate);
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

  function clear() {
    var storage = getStorage();
    if (!storage) error('저장 공간에 접근할 수 없습니다.');
    try {
      storage.removeItem(STORAGE_KEY);
    } catch (removeError) {
      error('데이터를 지우지 못했습니다.');
    }
  }

  function hasStoredState() {
    var storage = getStorage();
    var raw;
    if (!storage) error('저장 공간에 접근할 수 없습니다.');
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (readError) {
      error('저장된 가계부를 읽을 수 없습니다.');
    }
    return raw != null && raw !== '';
  }

  function hasDefaultCategories(categories) {
    var i;
    if (!Array.isArray(categories) || categories.length !== DEFAULT_CATEGORIES.length) {
      return false;
    }
    for (i = 0; i < DEFAULT_CATEGORIES.length; i += 1) {
      if (categories[i] !== DEFAULT_CATEGORIES[i]) return false;
    }
    return true;
  }

  function needsInitialSetup(state) {
    var normalized = stateForUse(state);
    return Boolean(
      normalized.onboardingComplete !== true &&
      normalized.entries.length === 0 &&
      normalized.limit === INITIAL_LIMIT &&
      normalized.limitChanges.length === 0 &&
      hasDefaultCategories(normalized.categories)
    );
  }

  function needsResetSetup(state) {
    return stateForUse(state).resetConfigured !== true;
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

  function open(options) {
    var stored = readStoredState();
    var fresh;
    var initialLimit;
    var initialResetDay;
    var onboardingComplete;

    if (options != null) {
      if (!isObject(options)) error('초기 설정 형식이 올바르지 않습니다.');
      initialLimit = options.initialLimit;
      if (initialLimit != null)
        assertNonNegativeInteger(initialLimit, '기본 한도');
      initialResetDay = options.initialResetDay;
      if (initialResetDay != null) assertResetDay(initialResetDay);
      onboardingComplete = options.onboardingComplete === true;
    }

    if (stored.state) {
      return cloneState(stored.state);
    }

    fresh = createFreshState(
      initialLimit,
      initialResetDay,
      onboardingComplete,
    );
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
    normalized = extendStartDate(normalized, isoDate);
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

  function setResetDay(state, value) {
    var normalized = stateForUse(state);
    var resetDay = value;
    var configuredOn = today();
    var cycleStart = cycleStartDate(normalized, configuredOn);
    var changes;
    var replaced = false;
    var next;

    assertResetDay(resetDay);
    changes = normalized.resetChanges.map(function (change) {
      if (change.configuredOn === configuredOn) {
        replaced = true;
        return {
          configuredOn: configuredOn,
          resetDay: resetDay,
          cycleStart: cycleStart,
        };
      }
      return {
        configuredOn: change.configuredOn,
        resetDay: change.resetDay,
        cycleStart: change.cycleStart,
      };
    });
    if (!replaced) {
      changes.push({
        configuredOn: configuredOn,
        resetDay: resetDay,
        cycleStart: cycleStart,
      });
    }
    changes.sort(function (left, right) {
      return compareDates(left.configuredOn, right.configuredOn);
    });
    next = cloneState(normalized);
    next.resetDay = resetDay;
    next.resetChanges = changes;
    next.resetConfigured = true;
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
    normalized = extendStartDate(normalized, isoDate);

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
    hasStoredState: hasStoredState,
    clear: clear,
    minDate: MIN_DATE,
    maxDate: MAX_DATE,
    needsInitialSetup: needsInitialSetup,
    needsResetSetup: needsResetSetup,
    save: save,
    day: day,
    setLimit: setLimit,
    setResetDay: setResetDay,
    resetInfo: resetInfo,
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
