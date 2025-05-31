document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const inputs = {
    userBirthdate: document.getElementById("user-birthdate"),
    expectedInflation: document.getElementById("expected-inflation"),
    lmpAmount: document.getElementById("lmp-amount"),
    lmpRate: document.getElementById("lmp-rate"),
    lmpYears: document.getElementById("lmp-years"),
    startBalance: document.getElementById("start-balance"),
    horizonYears: document.getElementById("horizon-years"),
    stockPct: document.getElementById("stock-pct"),
    bondPct: document.getElementById("bond-pct"),
    stockReturn: document.getElementById("stock-return"),
    stockSigma: document.getElementById("stock-sigma"),
    bondReturn: document.getElementById("bond-return"),
    bondSigma: document.getElementById("bond-sigma"),
    legacyTarget: document.getElementById("legacy-target"),
    nSims: document.getElementById("n-sims"),
    maxTotalSpendingValue: document.getElementById("max-total-spending-value"),
    maxTotalSpendingPeriod: document.getElementById(
      "max-total-spending-period"
    ),
    showSources: document.getElementById("show-sources"),
    displayMonthly: document.getElementById("display-monthly"),
    displayNominal: document.getElementById("display-nominal"),
  };

  const outputs = {
    legacy95th: document.getElementById("legacy-95th"),
    legacy50th: document.getElementById("legacy-50th"),
    legacy5th: document.getElementById("legacy-5th"),
    legacyBoxNote: document.getElementById("legacy-box-note"),
    summaryLmpCost: document.getElementById("summary-lmp-cost"),
    summaryRiskStart: document.getElementById("summary-risk-start"),
    summaryW0: document.getElementById("summary-w0"),
    chartMainTitle: document.getElementById("chart-main-title"),
    chartSubtitle: document.getElementById("chart-subtitle"),
  };

  const runSimButton = document.getElementById("run-sim");
  const exportCsvButton = document.getElementById("export-csv");
  const spendingChartCanvas = document.getElementById("spending-chart");
  let spendingChart = null;
  let allSimData = [];
  let currentChartSettingsForRedraw = null;
  let rawResultsByYear = []; // Store raw real results for toggling nominal display

  // --- Helper Functions ---
  const parseFloatInput = (element, defaultValue = 0) => {
    const value = element ? element.value : ""; // Check if element exists
    // Try to parse, if NaN or empty after parseFloat, use defaultValue
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  };
  const parseIntInput = (element, defaultValue = 0) => {
    const value = element ? element.value : ""; // Check if element exists
    const parsed = parseInt(value, 10); // Always specify radix 10 for parseInt
    return isNaN(parsed) ? defaultValue : parsed;
  };

  function randomNormal() {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function getNormalRandom(mean, stdDev) {
    return mean + stdDev * randomNormal();
  }

  function formatSimpleCurrency(value) {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  // --- LMP Logic --- (remains real)
  function calcLmpCost(amount, rate, years) {
    if (rate === 0) return amount * years;
    return (amount * (1 - Math.pow(1 + rate, -years))) / rate;
  }

  // --- Amortization Logic --- (remains real)
  function calcWithdrawal(balance, rate, years, legacyTarget) {
    if (years <= 0) return 0;
    if (balance <= 0 && legacyTarget <= 0) return 0;
    if (balance <= 0 && legacyTarget > 0) return 0;

    const adjustedBalanceForWithdrawal =
      balance - legacyTarget / Math.pow(1 + rate, years);

    if (adjustedBalanceForWithdrawal <= 0) return 0;

    if (rate === 0) {
      return adjustedBalanceForWithdrawal / years;
    }

    const numerator =
      adjustedBalanceForWithdrawal * rate * Math.pow(1 + rate, years);
    const denominator = Math.pow(1 + rate, years) - 1;
    if (denominator === 0) return adjustedBalanceForWithdrawal / years;
    return numerator / denominator;
  }

  // --- Monte Carlo Simulation ---
  function runMonteCarlo(settings) {
    const resultsByYear = Array(settings.horizonYears)
      .fill(null)
      .map(() => []);
    const legacyOutcomesReal = [];
    allSimData = [];

    const lmpCost = calcLmpCost(
      settings.lmpAmount,
      settings.lmpRate / 100,
      Math.min(settings.lmpYears, settings.horizonYears)
    );
    const riskStart = settings.startBalance - lmpCost;

    if (riskStart < 0) {
      alert(
        "Warning: LMP cost exceeds starting portfolio balance. Risk portfolio starts negative. Results may be unreliable."
      );
    }

    const avgPortfolioReturnReal =
      ((settings.stockPct / 100) * settings.stockReturn) / 100 +
      ((settings.bondPct / 100) * settings.bondReturn) / 100;

    const W0_real = calcWithdrawal(
      riskStart,
      avgPortfolioReturnReal,
      settings.horizonYears,
      settings.legacyTarget
    );

    outputs.summaryLmpCost.textContent = formatSimpleCurrency(lmpCost);
    outputs.summaryRiskStart.textContent = formatSimpleCurrency(riskStart);
    outputs.summaryW0.textContent = formatSimpleCurrency(W0_real);

    let effectiveAnnualRealCap = null;
    if (
      settings.maxTotalSpendingValue !== null &&
      settings.maxTotalSpendingValue > 0
    ) {
      effectiveAnnualRealCap = settings.maxTotalSpendingValue;
      if (settings.maxTotalSpendingPeriod === "monthly") {
        effectiveAnnualRealCap *= 12;
      }
    }

    for (let i = 0; i < settings.nSims; i++) {
      let currentBalanceReal = riskStart;
      let Wt_minus_1_real = W0_real;
      const simPath = [];

      for (let t = 0; t < settings.horizonYears; t++) {
        const cumulativeInflationFactor = Math.pow(
          1 + settings.expectedInflation / 100,
          t
        );

        let uncappedRiskWithdrawalReal = Wt_minus_1_real;
        if (currentBalanceReal <= 0) {
          uncappedRiskWithdrawalReal = 0;
        }
        uncappedRiskWithdrawalReal = Math.min(
          uncappedRiskWithdrawalReal,
          Math.max(0, currentBalanceReal)
        );

        const lmpContributionReal =
          t < settings.lmpYears ? settings.lmpAmount : 0;
        let actualRiskWithdrawalReal = uncappedRiskWithdrawalReal;

        if (effectiveAnnualRealCap !== null) {
          const totalUncappedRealSpending =
            lmpContributionReal + uncappedRiskWithdrawalReal;
          if (totalUncappedRealSpending > effectiveAnnualRealCap) {
            const preventativeSavingsReal =
              totalUncappedRealSpending - effectiveAnnualRealCap;
            actualRiskWithdrawalReal = Math.max(
              0,
              uncappedRiskWithdrawalReal - preventativeSavingsReal
            );
          }
        }
        actualRiskWithdrawalReal = Math.max(
          0,
          Math.min(actualRiskWithdrawalReal, currentBalanceReal)
        );

        let balanceAfterWithdrawalReal =
          currentBalanceReal - actualRiskWithdrawalReal;

        const r_stock_real = getNormalRandom(
          settings.stockReturn / 100,
          settings.stockSigma / 100
        );
        const r_bond_real = getNormalRandom(
          settings.bondReturn / 100,
          settings.bondSigma / 100
        );
        const portfolioReturnReal =
          (settings.stockPct / 100) * r_stock_real +
          (settings.bondPct / 100) * r_bond_real;

        let balanceAfterGrowthReal =
          balanceAfterWithdrawalReal * (1 + portfolioReturnReal);
        currentBalanceReal = Math.max(0, balanceAfterGrowthReal);

        const remainingYears = settings.horizonYears - (t + 1);
        let Wt_next_real = calcWithdrawal(
          currentBalanceReal,
          avgPortfolioReturnReal,
          remainingYears,
          settings.legacyTarget
        );
        Wt_next_real = Math.max(0, Wt_next_real);

        resultsByYear[t].push({
          lmpComponentReal: lmpContributionReal,
          riskComponentReal: actualRiskWithdrawalReal,
        });

        simPath.push({
          year: t + 1,
          sim: i + 1,
          startBalanceReal: t === 0 ? riskStart : simPath[t - 1].endBalanceReal,
          lmpPaymentReal: lmpContributionReal,
          riskWithdrawalReal: actualRiskWithdrawalReal,
          totalSpendingReal: lmpContributionReal + actualRiskWithdrawalReal,
          endBalanceReal: currentBalanceReal,
          cumulativeInflation: cumulativeInflationFactor,
        });

        Wt_minus_1_real = Wt_next_real;
      }
      legacyOutcomesReal.push(currentBalanceReal);
      allSimData.push(...simPath);
    }
    rawResultsByYear = resultsByYear;
    return { resultsByYear, legacyOutcomesReal };
  }

  // --- Aggregation & Percentiles ---
  function calculatePercentiles(data, percentiles = [0.05, 0.5, 0.95]) {
    if (!data || data.length === 0) {
      const emptyResult = {};
      percentiles.forEach((p) => (emptyResult[p] = 0));
      emptyResult.min = 0;
      emptyResult.max = 0;
      return emptyResult;
    }
    const sortedData = [...data].sort((a, b) => a - b);
    const results = {};
    percentiles.forEach((p) => {
      const index = Math.max(
        0,
        Math.min(sortedData.length - 1, Math.floor(p * (sortedData.length - 1)))
      );
      results[p] = sortedData[index];
    });
    results.min = sortedData[0];
    results.max = sortedData[sortedData.length - 1];
    return results;
  }

  // --- Charting Logic ---
  function updateChart(resultsByYearInput, legacyOutcomesInput, settings) {
    if (spendingChart) {
      spendingChart.destroy();
    }

    // ... (initial variable declarations: displayMonthly, displayNominal, etc. - NO CHANGE) ...
    const displayMonthly = settings.displayMonthly;
    const displayNominal = settings.displayNominal;
    const expectedInflationRate = settings.expectedInflation / 100;
    const divisor = displayMonthly ? 12 : 1;

    let timeUnit = displayMonthly ? "Monthly" : "Annual";
    let dollarType = displayNominal ? "Nominal" : "Real";
    outputs.chartMainTitle.textContent = `${timeUnit} Spending During Retirement (${dollarType} Dollars)`;
    outputs.chartSubtitle.textContent = displayNominal
      ? `Dollars are NOT adjusted for inflation (assuming ${settings.expectedInflation}% annual inflation)`
      : "These dollars ARE adjusted for inflation";
    outputs.legacyBoxNote.textContent = `Values are in ${dollarType.toLowerCase()} dollars.`;

    const startAge =
      settings.currentAge ||
      new Date().getFullYear() - new Date(settings.userBirthdate).getFullYear();
    const chartLabels = Array.from(
      { length: settings.horizonYears },
      (_, i) => `Age ${startAge + i}`
    );
    const datasets = [];
    const processedResultsByYear = resultsByYearInput.map(
      (yearDataPoints, t) => {
        const cumulativeInflation = displayNominal
          ? Math.pow(1 + expectedInflationRate, t)
          : 1;
        return yearDataPoints.map((dp) => ({
          lmpComponent: (dp.lmpComponentReal * cumulativeInflation) / divisor,
          riskComponent: (dp.riskComponentReal * cumulativeInflation) / divisor,
          totalSpending:
            ((dp.lmpComponentReal + dp.riskComponentReal) *
              cumulativeInflation) /
            divisor,
        }));
      }
    );
    const processedLegacyOutcomes = legacyOutcomesInput.map((legacyReal) => {
      const cumulativeInflationEnd = displayNominal
        ? Math.pow(1 + expectedInflationRate, settings.horizonYears)
        : 1;
      return Math.max(0, legacyReal * cumulativeInflationEnd);
    });
    const legacyPercentiles = calculatePercentiles(processedLegacyOutcomes);
    outputs.legacy5th.textContent = formatSimpleCurrency(
      legacyPercentiles[0.05]
    );
    outputs.legacy50th.textContent = formatSimpleCurrency(
      legacyPercentiles[0.5]
    );
    outputs.legacy95th.textContent = formatSimpleCurrency(
      legacyPercentiles[0.95]
    );

    // --- Dataset Creation ---
    // (This part defining the datasets array for 'showSources' or not remains the same as the previous correct version
    // Ensure datasets are pushed in the visual order: LMP, Risk5th, RiskMedian-5th, Risk95th-Median, TotalMedianLine)
    if (settings.showSources) {
      const lmpDataSeries = [];
      const risk5thData = [],
        riskMedianData = [],
        risk95thData = [];
      processedResultsByYear.forEach((yearDataPoints) => {
        lmpDataSeries.push(
          yearDataPoints[0] ? yearDataPoints[0].lmpComponent : 0
        );
        const riskSpendingValues = yearDataPoints.map((dp) => dp.riskComponent);
        const p = calculatePercentiles(riskSpendingValues);
        risk5thData.push(p[0.05]);
        riskMedianData.push(p[0.5]);
        risk95thData.push(p[0.95]);
      });
      datasets.push({
        label: `LMP Guaranteed (${dollarType})`,
        data: lmpDataSeries,
        backgroundColor: "rgba(75, 192, 192, 0.7)",
        stack: "SpendingStack",
      });
      datasets.push({
        label: `Risk Portfolio (5th Perc. ${dollarType})`,
        data: risk5thData.map((val) => Math.max(0, val)),
        backgroundColor: "rgba(255, 99, 132, 0.5)",
        stack: "SpendingStack",
      });
      datasets.push({
        label: `Risk Portfolio (Median - 5th Perc. ${dollarType})`,
        data: riskMedianData.map((m, idx) => Math.max(0, m - risk5thData[idx])),
        backgroundColor: "rgba(255, 159, 64, 0.6)",
        stack: "SpendingStack",
      });
      datasets.push({
        label: `Risk Portfolio (95th - Median Perc. ${dollarType})`,
        data: risk95thData.map((m, idx) =>
          Math.max(0, m - riskMedianData[idx])
        ),
        backgroundColor: "rgba(255, 205, 86, 0.6)",
        stack: "SpendingStack",
      });
      datasets.push({
        // This is the LINE dataset
        label: `Total Median Spending (${dollarType})`,
        data: lmpDataSeries.map((lmp, idx) =>
          Math.max(0, lmp + riskMedianData[idx])
        ),
        type: "line",
        borderColor: "#3e6482",
        fill: false,
        tension: 0.1,
        borderWidth: 2.5,
        pointRadius: 0,
        order: 0,
      });
    } else {
      const medianData = [];
      const rangeData5th95th = [];
      processedResultsByYear.forEach((yearDataPoints) => {
        const totalSpendingValues = yearDataPoints.map(
          (dp) => dp.totalSpending
        );
        const percentiles = calculatePercentiles(totalSpendingValues);
        medianData.push(percentiles[0.5]);
        rangeData5th95th.push([percentiles[0.05], percentiles[0.95]]);
      });
      datasets.push({
        label: `5th-95th Percentile Spending (${dollarType})`,
        data: rangeData5th95th,
        backgroundColor: "rgba(121, 165, 197, 0.3)",
        borderColor: "rgba(121, 165, 197, 0.5)",
        borderWidth: 1,
        barPercentage: 0.8,
        categoryPercentage: 0.9,
        order: 2,
      });
      datasets.push({
        // This is the LINE dataset
        label: `Median Spending (${dollarType})`,
        data: medianData,
        type: "line",
        borderColor: "#3e6482",
        backgroundColor: "#3e6482",
        fill: false,
        tension: 0.1,
        borderWidth: 2,
        pointRadius: 0,
        order: 1,
      });
    }
    // --- End of Dataset Creation ---

    const currencySymbol = formatSimpleCurrency(0).charAt(0);
    const chartConfig = {
      type: "bar",
      data: { labels: chartLabels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          /* ... existing scales ... */
        },
        plugins: {
          tooltip: {
            enabled: true,
            mode: "index",
            intersect: false,
            itemSort: function (a, b) {
              // Sort tooltip items
              // We want "Total Median Spending" line to appear after "Total Stack" (if present)
              // and before other bar segments when showSources is true.
              // For other cases, default sort is fine.
              if (settings.showSources) {
                const labelA = a.dataset.label || "";
                const labelB = b.dataset.label || "";

                // "Total Median Spending" line dataset has a specific label
                const medianLineLabel = `Total Median Spending (${dollarType})`;

                if (labelA === medianLineLabel && labelB !== medianLineLabel)
                  return -1; // A (median line) comes before B
                if (labelB === medianLineLabel && labelA !== medianLineLabel)
                  return 1; // B (median line) comes before A
              }
              return a.datasetIndex - b.datasetIndex; // Default sort by datasetIndex
            },
            callbacks: {
              title: function (tooltipItems) {
                /* ... existing title callback ... */
                if (!tooltipItems || tooltipItems.length === 0) return "";
                const yearIndex = tooltipItems[0].dataIndex;
                const age = startAge + yearIndex;
                const birthDate = new Date(settings.userBirthdate);
                let calendarYear = birthDate.getFullYear() + age;
                if (
                  new Date().getMonth() < birthDate.getMonth() ||
                  (new Date().getMonth() === birthDate.getMonth() &&
                    new Date().getDate() < birthDate.getDate())
                ) {
                  calendarYear--;
                }
                return `Age: ${age} (Approx. ${calendarYear})`;
              },
              // Specific label/body callbacks will be added below conditionally
            },
          },
          legend: { position: "top", reverse: true },
        },
        interaction: { mode: "index", axis: "x", intersect: false },
      },
    };

    // Conditionally add/override tooltip label, beforeBody, afterBody callbacks
    if (settings.showSources) {
      let tooltipTotalStackCalculatedForIndex = -1;
      let currentTotalStackString = "";

      chartConfig.options.plugins.tooltip.callbacks.beforeBody = function (
        tooltipItems
      ) {
        const lines = [];
        if (tooltipItems.length > 0) {
          const dataIndex = tooltipItems[0].dataIndex;
          // 1. Calculate and add "Total Stack"
          if (tooltipTotalStackCalculatedForIndex !== dataIndex) {
            let totalStack = 0;
            const chart = this.chart;
            chart.data.datasets.forEach((ds) => {
              if (
                ds.stack === "SpendingStack" &&
                chart.isDatasetVisible(chart.data.datasets.indexOf(ds)) &&
                ds.type !== "line"
              ) {
                const value = ds.data[dataIndex];
                if (typeof value === "number") totalStack += value;
              }
            });
            currentTotalStackString = `Total Stack: ${formatSimpleCurrency(
              totalStack
            )}`;
            tooltipTotalStackCalculatedForIndex = dataIndex;
          }
          if (currentTotalStackString) {
            lines.push(currentTotalStackString);
          }

          // 2. Find and add "Total Median Spending" line value if it's not already handled by itemSort/label
          // This is tricky because beforeBody runs before individual label callbacks.
          // The itemSort should handle the order of items passed to 'label'.
          // We will rely on itemSort to position the median line correctly,
          // and the label callback will format it.
        }
        return lines; // Only "Total Stack" is prepended here.
      };

      chartConfig.options.plugins.tooltip.callbacks.label = function (context) {
        let label = context.dataset.label || "";
        if (label) label += ": ";
        label += formatSimpleCurrency(context.parsed.y);
        return label;
      };

      chartConfig.options.plugins.tooltip.callbacks.afterBody = function () {
        tooltipTotalStackCalculatedForIndex = -1; // Reset for next hover point
        currentTotalStackString = "";
        return [];
      };
    } else {
      // Tooltip for non-stacked view
      chartConfig.options.plugins.tooltip.callbacks.label = function (context) {
        let label = context.dataset.label || "";
        if (label) label += ": ";
        if (context.parsed.y !== null) {
          if (Array.isArray(context.raw) && context.raw.length === 2) {
            label += `${formatSimpleCurrency(
              context.raw[0]
            )} - ${formatSimpleCurrency(context.raw[1])}`;
          } else {
            label += formatSimpleCurrency(context.parsed.y);
          }
        }
        return label;
      };
    }

    spendingChart = new Chart(spendingChartCanvas, chartConfig);
  }

  // --- Data Export ---
  function exportToCsv(
    dataToExport,
    filename = "tpaw_simulation_data.csv",
    settings
  ) {
    if (dataToExport.length === 0) {
      alert("No data to export. Run a simulation first.");
      return;
    }

    const displayNominal = settings.displayNominal;
    const headerKeys = Object.keys(dataToExport[0]);
    let header = headerKeys.join(",");
    let headerModifiedForNominal = false; // Flag to modify header only once for nominal export
    let headerModifiedForReal = false; // Flag to modify header only once for real export

    const rows = dataToExport.map((row) => {
      if (displayNominal) {
        const nominalRow = { ...row };
        nominalRow.startBalanceReal =
          row.startBalanceReal * row.cumulativeInflation;
        nominalRow.lmpPaymentReal =
          row.lmpPaymentReal * row.cumulativeInflation;
        nominalRow.riskWithdrawalReal =
          row.riskWithdrawalReal * row.cumulativeInflation;
        nominalRow.totalSpendingReal =
          row.totalSpendingReal * row.cumulativeInflation;
        nominalRow.endBalanceReal =
          row.endBalanceReal * row.cumulativeInflation;

        if (!headerModifiedForNominal) {
          header = header.replace(/Real/g, "Nominal");
          // Ensure specific common headers are updated if they exist
          header = header
            .replace("startBalanceNominal", "startBalanceNominal")
            .replace("lmpPaymentNominal", "lmpPaymentNominal")
            .replace("riskWithdrawalNominal", "riskWithdrawalNominal")
            .replace("totalSpendingNominal", "totalSpendingNominal")
            .replace("endBalanceNominal", "endBalanceNominal");
          headerModifiedForNominal = true;
          headerModifiedForReal = false; // Reset other flag
        }
        return Object.values(nominalRow).join(",");
      } else {
        if (!headerModifiedForReal) {
          header = header.replace(/Nominal/g, "Real");
          headerModifiedForReal = true;
          headerModifiedForNominal = false; // Reset other flag
        }
        return Object.values(row).join(",");
      }
    });

    const csvContent = `data:text/csv;charset=utf-8,${header}\n${rows.join(
      "\n"
    )}`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Main Simulation Orchestration ---
  let lastSimResults = null;

  function runSimulation(forceResimulate = false) {
    const stockPctVal = parseFloatInput(inputs.stockPct);
    const bondPctVal = parseFloatInput(inputs.bondPct);
    if (Math.abs(stockPctVal + bondPctVal - 100) > 0.1) {
      if (
        !confirm(
          `Stock % (${stockPctVal}%) + Bond % (${bondPctVal}%) does not equal 100%. Continue anyway?`
        )
      ) {
        return;
      }
    }

    const settings = {
      userBirthdate: inputs.userBirthdate.value,
      expectedInflation: parseFloatInput(inputs.expectedInflation, 2.5),
      lmpAmount: parseFloatInput(inputs.lmpAmount, 0),
      lmpRate: parseFloatInput(inputs.lmpRate, 0),
      lmpYears: parseIntInput(inputs.lmpYears, 30),
      startBalance: parseFloatInput(inputs.startBalance, 0),
      horizonYears: parseIntInput(inputs.horizonYears, 30),
      stockPct: stockPctVal,
      bondPct: bondPctVal,
      stockReturn: parseFloatInput(inputs.stockReturn, 7),
      stockSigma: parseFloatInput(inputs.stockSigma, 15),
      bondReturn: parseFloatInput(inputs.bondReturn, 2.5),
      bondSigma: parseFloatInput(inputs.bondSigma, 5),
      legacyTarget: parseFloatInput(inputs.legacyTarget, 0),
      nSims: parseIntInput(inputs.nSims, 1000),
      maxTotalSpendingValue: inputs.maxTotalSpendingValue.value
        ? parseFloatInput(inputs.maxTotalSpendingValue)
        : null,
      maxTotalSpendingPeriod: inputs.maxTotalSpendingPeriod.value,
      showSources: inputs.showSources.checked,
      displayMonthly: inputs.displayMonthly.checked,
      displayNominal: inputs.displayNominal.checked,
      currentAge:
        new Date().getFullYear() -
        new Date(inputs.userBirthdate.value).getFullYear(),
    };
    currentChartSettingsForRedraw = settings;

    if (forceResimulate || !lastSimResults) {
      runSimButton.disabled = true;
      runSimButton.textContent = "Simulating...";

      setTimeout(() => {
        const { resultsByYear, legacyOutcomesReal } = runMonteCarlo(settings);
        lastSimResults = { resultsByYear, legacyOutcomesReal };
        updateChart(
          lastSimResults.resultsByYear,
          lastSimResults.legacyOutcomesReal,
          settings
        );

        runSimButton.disabled = false;
        runSimButton.textContent = "Run Simulation";
      }, 10);
    } else {
      updateChart(
        lastSimResults.resultsByYear,
        lastSimResults.legacyOutcomesReal,
        settings
      );
    }
  }

  // --- Event Listeners ---
  runSimButton.addEventListener("click", () => runSimulation(true));

  exportCsvButton.addEventListener("click", () => {
    if (allSimData.length > 0 && currentChartSettingsForRedraw) {
      exportToCsv(
        allSimData,
        "tpaw_simulation_data.csv",
        currentChartSettingsForRedraw
      );
    } else {
      alert("No data to export. Run a simulation first.");
    }
  });

  [inputs.showSources, inputs.displayMonthly, inputs.displayNominal].forEach(
    (inputElement) => {
      if (inputElement) {
        inputElement.addEventListener("change", () => {
          if (lastSimResults) {
            runSimulation(false);
          }
        });
      }
    }
  );

  if (inputs.stockPct) {
    inputs.stockPct.addEventListener("change", () => {
      const stockVal = parseFloatInput(inputs.stockPct, 60);
      if (stockVal >= 0 && stockVal <= 100 && inputs.bondPct) {
        inputs.bondPct.value = (100 - stockVal).toString();
      }
      lastSimResults = null;
    });
  }

  if (inputs.bondPct) {
    inputs.bondPct.addEventListener("change", () => {
      const bondVal = parseFloatInput(inputs.bondPct, 40);
      if (bondVal >= 0 && bondVal <= 100 && inputs.stockPct) {
        inputs.stockPct.value = (100 - bondVal).toString();
      }
      lastSimResults = null;
    });
  }

  const coreInputsForResimulation = [
    inputs.userBirthdate,
    inputs.expectedInflation,
    inputs.lmpAmount,
    inputs.lmpRate,
    inputs.lmpYears,
    inputs.startBalance,
    inputs.horizonYears,
    inputs.stockReturn,
    inputs.stockSigma,
    inputs.bondReturn,
    inputs.bondSigma,
    inputs.legacyTarget,
    inputs.nSims,
    inputs.maxTotalSpendingValue,
    inputs.maxTotalSpendingPeriod,
  ];
  coreInputsForResimulation.forEach((inputElement) => {
    if (inputElement) {
      inputElement.addEventListener("change", () => {
        lastSimResults = null;
      });
    } else {
      // This else block can help identify which input might be missing during development
      // For production, you might remove it or log more discreetly.
      // console.warn("A core input element expected for resimulation trigger was not found.");
    }
  });
});
//
