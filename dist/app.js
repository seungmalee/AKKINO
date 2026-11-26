(function () {
  "use strict";
  var api = window.Ledger;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var money = new Intl.NumberFormat("ko-KR");
  var state, selectedDate, knownToday;
  var followingToday = true;
  var rows = [];
  var dateRows = new Map();
  var rowSequence = 0;
  var limitEditDate = null;
  var limitDirty = false;
  var limitError = "";
  var hasSaved = false;
  var ADD_CATEGORY = "__ledger_add_category__";

  function format(amount) {
    return money.format(amount);
  }
  function signed(amount) {
    return (
      (amount > 0 ? "+" : amount < 0 ? "−" : "") + format(Math.abs(amount))
    );
  }
  function shiftDate(iso, count) {
    var date = new Date(iso + "T12:00:00");
    date.setDate(date.getDate() + count);
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }
  function parseMoney(raw, allowZero) {
    var value = raw.trim().replace(/,/g, "");
    if (!/^\d+$/.test(value)) throw new Error("금액은 숫자로 입력해주세요.");
    var amount = Number(value);
    if (!Number.isSafeInteger(amount))
      throw new Error("정확히 계산할 수 있는 금액을 초과했어요.");
    if (amount > 1000000000000)
      throw new Error("금액은 1조 원 이하로 입력해주세요.");
    if (amount < (allowZero ? 0 : 1))
      throw new Error(
        allowZero
          ? "한도는 0원 이상이어야 해요."
          : "지출은 1원 이상 입력해주세요.",
      );
    return amount;
  }
  function setPageError(message) {
    $("fatal-error").textContent = message || "";
    $("fatal-error").hidden = !message;
  }
  function setLimitError(message) {
    limitError = message || "";
    $("limit-error").textContent = limitError;
    $("limit-error").hidden = !limitError;
    $("daily-limit-input").setAttribute(
      "aria-invalid",
      String(Boolean(limitError)),
    );
    updateStatus();
  }
  function setRowError(row, message, field) {
    row.error = message || "";
    row.errorCell.textContent = row.error;
    row.messageElement.hidden = !row.error;
    [
      row.amountInput,
      row.categorySelect,
      row.categoryInput,
      row.noteInput,
    ].forEach(function (input) {
      input.setAttribute(
        "aria-invalid",
        String(Boolean(message && input === field)),
      );
    });
    updateStatus();
  }
  function updateStatus() {
    var text;
    if (
      limitError ||
      rows.some(function (row) {
        return Boolean(row.error);
      })
    )
      text = "저장하지 못한 입력이 있어요.";
    else if (
      rows.some(function (row) {
        return row.confirmDelete;
      })
    )
      text = "×를 한 번 더 누르면 삭제돼요.";
    else if (
      limitDirty ||
      rows.some(function (row) {
        return row.dirty || row.addingCategory;
      })
    )
      text = "입력 중";
    else if (
      rows.some(function (row) {
        return !row.amountInput.value.trim() && row.noteInput.value.trim();
      })
    )
      text = "금액을 입력하면 저장돼요.";
    else text = hasSaved ? "자동 저장됨" : "입력하면 자동 저장돼요.";
    $("save-status").textContent = text;
  }
  function saveState(next) {
    api.save(next);
    state = next;
    hasSaved = true;
    setPageError("");
  }
  function savedEntry(row) {
    return row.savedId
      ? state.entries.find(function (entry) {
          return entry.id === row.savedId;
        })
      : null;
  }
  function updateTotals() {
    if (!state) return;
    try {
      var view = api.day(state, selectedDate);
      var spent = view.spent;
      rows.forEach(function (row) {
        var stored = savedEntry(row);
        var amount;
        if (!row.amountInput.value.trim()) amount = 0;
        else {
          try {
            amount = parseMoney(row.amountInput.value, false);
          } catch (ignore) {
            amount = stored ? stored.amount : 0;
          }
        }
        spent += amount - (stored ? stored.amount : 0);
      });
      var limit = view.limit;
      if (limitDirty && limitEditDate === selectedDate) {
        try {
          limit = parseMoney($("daily-limit-input").value, true);
        } catch (ignore) {}
      }
      var remaining = limit + view.carry - spent;
      var safe = Number.isSafeInteger(spent) && Number.isSafeInteger(remaining);
      $("spent-amount").textContent = safe ? format(spent) : "계산 범위 초과";
      $("remaining-amount").textContent = safe
        ? signed(remaining).replace(/^\+/, "")
        : "—";
      $("carry-amount").textContent = signed(view.carry);
      document
        .querySelector(".remaining-total")
        .classList.toggle("is-over", remaining < 0);
      updateStatus();
    } catch (error) {
      setPageError(error.message);
    }
  }
  function fillCategories(row) {
    row.categorySelect.replaceChildren();
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "선택";
    placeholder.disabled = true;
    row.categorySelect.append(placeholder);
    state.categories.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      row.categorySelect.append(option);
    });
    var add = document.createElement("option");
    add.value = ADD_CATEGORY;
    add.textContent = "＋ 카테고리 추가";
    row.categorySelect.append(add);
    row.categorySelect.value = row.category || "";
  }
  function refreshAllCategories() {
    dateRows.forEach(function (list) {
      list.forEach(fillCategories);
    });
  }
  function cancelDelete(row) {
    row.confirmDelete = false;
    row.deleteButton.classList.remove("is-confirming");
    row.deleteButton.setAttribute("aria-label", "행 삭제");
    row.deleteButton.title = "행 삭제";
  }
  function markDirty(row) {
    row.dirty = true;
    cancelDelete(row);
    setRowError(row, "");
    updateTotals();
    clearTimeout(row.timer);
    row.timer = setTimeout(function () {
      persistRow(row);
    }, 450);
  }
  function finishCategory(row, cancel) {
    if (!row.addingCategory) return true;
    var name = row.categoryInput.value.trim();
    if (cancel || !name) {
      row.addingCategory = false;
      row.categoryInput.hidden = true;
      row.categorySelect.hidden = false;
      row.categorySelect.value = row.category;
      setRowError(row, "");
      updateStatus();
      return true;
    }
    try {
      state = api.open();
      if (state.categories.indexOf(name) < 0)
        saveState(api.addCategory(state, name));
      row.category = name;
      row.addingCategory = false;
      row.categoryInput.hidden = true;
      row.categorySelect.hidden = false;
      refreshAllCategories();
      row.dirty = true;
      return persistRow(row);
    } catch (error) {
      setRowError(row, error.message, row.categoryInput);
      return false;
    }
  }
  function persistRow(row) {
    clearTimeout(row.timer);
    if (row.removed || row.addingCategory) return !row.error;
    var rawAmount = row.amountInput.value.trim();
    var note = row.noteInput.value.trim();
    try {
      if (!rawAmount) {
        if (row.savedId) {
          saveState(api.removeExpense(api.open(), row.savedId));
          row.savedId = null;
          row.original = null;
          row.element.removeAttribute("data-entry-id");
        }
        row.dirty = false;
        setRowError(row, "");
        updateTotals();
        return true;
      }
      var amount = parseMoney(rawAmount, false);
      if (!row.category) {
        setRowError(row, "카테고리를 선택해주세요.", row.categorySelect);
        return false;
      }
      if (
        !row.original ||
        row.original.category !== row.category ||
        row.original.amount !== amount ||
        row.original.note !== note
      ) {
        var current = api.open();
        var next = row.savedId
          ? api.updateExpense(current, row.savedId, row.category, amount, note)
          : api.addExpense(current, row.date, row.category, amount, note);
        saveState(next);
        if (!row.savedId) {
          var previousIds = new Set(
            current.entries.map(function (entry) {
              return entry.id;
            }),
          );
          var created = next.entries.find(function (entry) {
            return !previousIds.has(entry.id);
          });
          row.savedId = created.id;
          row.element.dataset.entryId = row.savedId;
        }
        row.original = { category: row.category, amount: amount, note: note };
      }
      row.dirty = false;
      if (document.activeElement !== row.amountInput)
        row.amountInput.value = format(amount);
      setRowError(row, "");
      updateTotals();
      return true;
    } catch (error) {
      setRowError(row, error.message || "저장하지 못했어요.", row.amountInput);
      updateTotals();
      return false;
    }
  }
  function isCompositionEvent(event) {
    return Boolean(event.isComposing || event.keyCode === 229);
  }
  function persistAndAppendRow(row) {
    var selected;
    var rawAmount;
    if (row.removed || row.addingCategory) return false;
    selected = row.categorySelect.value;
    if (selected === ADD_CATEGORY) return false;
    if (selected !== row.category) {
      row.category = selected;
      row.dirty = true;
    }
    rawAmount = row.amountInput.value.trim();
    if (!row.category) {
      setRowError(row, "카테고리를 선택해주세요.", row.categorySelect);
      return false;
    }
    if (!rawAmount) {
      setRowError(row, "금액을 입력해주세요.", row.amountInput);
      return false;
    }
    if (!persistRow(row) || !row.savedId) return false;
    appendBlankRow();
    return true;
  }
  function createInput(className, label, key) {
    var input = document.createElement("input");
    input.type = "text";
    input.className = "row-control " + className;
    input.setAttribute("aria-label", label);
    input.setAttribute("aria-describedby", key + "-error");
    input.autocomplete = "off";
    return input;
  }
  function createRow(entry, date) {
    var key = "ledger-row-" + ++rowSequence;
    var row = {
      key: key,
      date: date,
      savedId: entry ? entry.id : null,
      category: entry ? entry.category : "",
      original: entry
        ? { category: entry.category, amount: entry.amount, note: entry.note }
        : null,
      dirty: false,
      addingCategory: false,
      error: "",
      confirmDelete: false,
      removed: false,
    };
    row.element = document.createElement("tr");
    row.element.id = key;
    row.element.dataset.rowKey = key;
    if (row.savedId) row.element.dataset.entryId = row.savedId;
    var categoryCell = document.createElement("td");
    row.categorySelect = document.createElement("select");
    row.categorySelect.className = "row-control category-select";
    row.categorySelect.setAttribute("aria-label", "카테고리");
    row.categorySelect.setAttribute("aria-describedby", key + "-error");
    row.categoryInput = createInput(
      "category-name-input",
      "새 카테고리 이름",
      key,
    );
    row.categoryInput.placeholder = "새 카테고리";
    row.categoryInput.title = "이름 입력 후 Enter";
    row.categoryInput.maxLength = 20;
    row.categoryInput.hidden = true;
    categoryCell.append(row.categorySelect, row.categoryInput);
    var amountCell = document.createElement("td");
    row.amountInput = createInput("amount-input", "금액", key);
    row.amountInput.inputMode = "numeric";
    row.amountInput.maxLength = 22;
    row.amountInput.placeholder = "0";
    row.amountInput.value = entry ? format(entry.amount) : "";
    amountCell.append(row.amountInput);
    var noteCell = document.createElement("td");
    row.noteInput = createInput("note-input", "상세내용", key);
    row.noteInput.maxLength = 80;
    row.noteInput.placeholder = "내용 입력";
    row.noteInput.value = entry ? entry.note : "";
    noteCell.append(row.noteInput);
    var deleteCell = document.createElement("td");
    row.deleteButton = document.createElement("button");
    row.deleteButton.type = "button";
    row.deleteButton.className = "delete-row";
    row.deleteButton.textContent = "×";
    row.deleteButton.setAttribute("aria-label", "행 삭제");
    row.deleteButton.title = "행 삭제";
    deleteCell.append(row.deleteButton);
    row.element.append(categoryCell, amountCell, noteCell, deleteCell);
    row.messageElement = document.createElement("tr");
    row.messageElement.className = "row-message";
    row.messageElement.hidden = true;
    row.errorCell = document.createElement("td");
    row.errorCell.colSpan = 4;
    row.errorCell.id = key + "-error";
    row.errorCell.setAttribute("role", "alert");
    row.messageElement.append(row.errorCell);
    fillCategories(row);
    row.categorySelect.addEventListener("change", function () {
      cancelDelete(row);
      if (this.value === ADD_CATEGORY) {
        row.addingCategory = true;
        row.categorySelect.value = row.category;
        row.categorySelect.hidden = true;
        row.categoryInput.hidden = false;
        row.categoryInput.value = "";
        row.categoryInput.focus();
        updateStatus();
      } else {
        row.category = this.value;
        row.dirty = true;
        persistRow(row);
      }
    });
    row.categorySelect.addEventListener("keydown", function (event) {
      if (isCompositionEvent(event) || event.repeat || event.key !== "Enter")
        return;
      if (!this.value || this.value === ADD_CATEGORY || !row.amountInput.value.trim())
        return;
      event.preventDefault();
      persistAndAppendRow(row);
    });
    row.categoryInput.addEventListener("keydown", function (event) {
      if (isCompositionEvent(event) || event.repeat) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (finishCategory(row, false)) row.amountInput.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishCategory(row, true);
        row.categorySelect.focus();
      }
    });
    row.categoryInput.addEventListener("blur", function () {
      finishCategory(row, false);
    });
    [row.amountInput, row.noteInput].forEach(function (input) {
      input.addEventListener("input", function () {
        markDirty(row);
      });
      input.addEventListener("change", function () {
        persistRow(row);
      });
      input.addEventListener("blur", function () {
        persistRow(row);
        window.setTimeout(function () {
          syncCurrentDay(false);
        }, 0);
      });
      input.addEventListener("keydown", function (event) {
        if (isCompositionEvent(event) || event.repeat) return;
        if (event.key === "Enter") {
          event.preventDefault();
          persistAndAppendRow(row);
        }
      });
    });
    row.deleteButton.addEventListener("click", function () {
      removeRow(row);
    });
    return row;
  }
  function appendRow(row) {
    rows.push(row);
    dateRows.set(selectedDate, rows);
    $("ledger-rows").append(row.element, row.messageElement);
  }
  function appendBlankRow() {
    var row = createRow(null, selectedDate);
    appendRow(row);
    row.categorySelect.focus();
    updateStatus();
    return row;
  }
  function removeRow(row) {
    clearTimeout(row.timer);
    if (row.savedId && !row.confirmDelete) {
      row.confirmDelete = true;
      row.deleteButton.classList.add("is-confirming");
      row.deleteButton.setAttribute("aria-label", "이 행 삭제 확인");
      row.deleteButton.title = "한 번 더 누르면 삭제";
      updateStatus();
      return;
    }
    try {
      if (row.savedId) saveState(api.removeExpense(api.open(), row.savedId));
      row.removed = true;
      row.element.remove();
      row.messageElement.remove();
      rows = rows.filter(function (item) {
        return item !== row;
      });
      dateRows.set(selectedDate, rows);
      if (!rows.length) appendRow(createRow(null, selectedDate));
      updateTotals();
      $("add-row").focus();
    } catch (error) {
      setRowError(row, error.message);
    }
  }
  function loadDateRows() {
    var cached = dateRows.get(selectedDate);
    rows =
      cached ||
      api
        .day(state, selectedDate)
        .entries.slice()
        .reverse()
        .map(function (entry) {
          return createRow(entry, selectedDate);
        });
    dateRows.set(selectedDate, rows);
    if (!rows.length) rows.push(createRow(null, selectedDate));
    $("ledger-rows").replaceChildren();
    rows.forEach(function (row) {
      $("ledger-rows").append(row.element, row.messageElement);
    });
    reconcileSavedRows();
  }
  function reconcileSavedRows() {
    var entries = api.day(state, selectedDate).entries;
    var visibleIds = new Set();
    rows.slice().forEach(function (row) {
      if (!row.savedId) return;
      visibleIds.add(row.savedId);
      if (
        row.dirty ||
        row.addingCategory ||
        row.element.contains(document.activeElement)
      )
        return;
      var entry = entries.find(function (item) {
        return item.id === row.savedId;
      });
      if (!entry) {
        row.removed = true;
        row.element.remove();
        row.messageElement.remove();
        rows = rows.filter(function (item) {
          return item !== row;
        });
      } else {
        row.category = entry.category;
        fillCategories(row);
        row.amountInput.value = format(entry.amount);
        row.noteInput.value = entry.note;
        row.original = {
          category: entry.category,
          amount: entry.amount,
          note: entry.note,
        };
      }
    });
    entries
      .slice()
      .reverse()
      .forEach(function (entry) {
        if (!visibleIds.has(entry.id))
          appendRow(createRow(entry, selectedDate));
      });
    if (!rows.length) appendRow(createRow(null, selectedDate));
    dateRows.set(selectedDate, rows);
  }
  function paintDate() {
    var today = api.today();
    $("selected-date").min = state.startDate;
    $("selected-date").max = today;
    $("selected-date").value = selectedDate;
    $("previous-day").disabled = selectedDate <= state.startDate;
    $("next-day").disabled = selectedDate >= today;
    $("today-button").hidden = selectedDate === today;
    if (!limitDirty && document.activeElement !== $("daily-limit-input"))
      $("daily-limit-input").value = format(api.day(state, selectedDate).limit);
  }
  function saveLimit() {
    if (!limitDirty) return true;
    try {
      var amount = parseMoney($("daily-limit-input").value, true);
      saveState(
        api.setLimit(api.open(), limitEditDate || selectedDate, amount),
      );
      limitDirty = false;
      setLimitError("");
      if (document.activeElement !== $("daily-limit-input"))
        $("daily-limit-input").value = format(amount);
      updateTotals();
      return true;
    } catch (error) {
      setLimitError(error.message);
      return false;
    }
  }
  function flushRows() {
    var valid = true;
    rows.forEach(function (row) {
      if (row.addingCategory && !finishCategory(row, false)) valid = false;
      if ((row.dirty || row.error) && !persistRow(row)) valid = false;
    });
    return valid;
  }
  function navigate(iso) {
    if (!iso || iso < state.startDate || iso > api.today()) {
      $("selected-date").value = selectedDate;
      return;
    }
    if (!saveLimit() || !flushRows()) {
      $("selected-date").value = selectedDate;
      return;
    }
    try {
      state = api.open();
      selectedDate = iso;
      knownToday = api.today();
      followingToday = selectedDate === knownToday;
      limitEditDate = null;
      loadDateRows();
      paintDate();
      updateTotals();
      setPageError("");
    } catch (error) {
      setPageError(error.message);
    }
  }
  function isEditing() {
    return (
      $("ledger-rows").contains(document.activeElement) ||
      document.activeElement === $("daily-limit-input") ||
      limitDirty
    );
  }
  function syncCurrentDay(forceReload) {
    try {
      var today = api.today();
      var shouldMove = followingToday && selectedDate !== today && !isEditing();
      if (!forceReload && knownToday === today && !shouldMove) return;
      if (shouldMove) {
        if (!flushRows()) return;
        navigate(today);
        return;
      }
      state = api.open();
      knownToday = today;
      reconcileSavedRows();
      paintDate();
      updateTotals();
    } catch (error) {
      setPageError(error.message);
    }
  }
  function start() {
    if (!api)
      throw new Error(
        "가계부를 불러오지 못했어요. 파일이 모두 있는지 확인해주세요.",
      );
    state = api.open();
    selectedDate = api.today();
    knownToday = selectedDate;
    loadDateRows();
    paintDate();
    updateTotals();
    $("previous-day").addEventListener("click", function () {
      navigate(shiftDate(selectedDate, -1));
    });
    $("next-day").addEventListener("click", function () {
      navigate(shiftDate(selectedDate, 1));
    });
    $("selected-date").addEventListener("change", function () {
      navigate(this.value);
    });
    $("today-button").addEventListener("click", function () {
      navigate(api.today());
    });
    $("add-row").addEventListener("click", function () {
      syncCurrentDay(false);
      appendBlankRow();
    });
    $("daily-limit-input").addEventListener("focus", function () {
      if (!limitDirty) limitEditDate = selectedDate;
    });
    $("daily-limit-input").addEventListener("input", function () {
      limitDirty = true;
      setLimitError("");
      updateTotals();
    });
    $("daily-limit-input").addEventListener("blur", function () {
      if (saveLimit()) {
        limitEditDate = null;
        paintDate();
        window.setTimeout(function () {
          syncCurrentDay(false);
        }, 0);
      }
    });
    $("daily-limit-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        if (saveLimit()) this.blur();
      } else if (event.key === "Escape") {
        limitDirty = false;
        setLimitError("");
        this.value = format(api.day(state, selectedDate).limit);
        this.blur();
        updateTotals();
      }
    });
    window.addEventListener("storage", function () {
      syncCurrentDay(true);
    });
    window.addEventListener("focus", function () {
      syncCurrentDay(true);
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) syncCurrentDay(true);
    });
    window.setInterval(function () {
      syncCurrentDay(false);
    }, 30000);
  }
  try {
    start();
  } catch (error) {
    setPageError(error.message || "가계부를 불러오지 못했어요.");
    $("save-status").textContent = "저장 상태 확인 필요";
    document
      .querySelectorAll("button,input,select")
      .forEach(function (element) {
        element.disabled = true;
      });
  }
})();
