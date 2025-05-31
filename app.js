document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const inputs = {
    userBirthdate: document.getElementById("user-birthdate"),
    expectedInflation: document.getElementById("expected-inflation"), // NEW
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
    maxTotalSpending: document.getElementById("max-total-spending"), // UPDATED ID
    showSources: document.getElementById("show-sources"),
    displayMonthly: document.getElementById("display-monthly"),
    displayNominal: document.getElementById("display-nominal"), // NEW
  };

  const outputs = {
    legacy95th: document.getElementById("legacy-95th"),
    legacy50th: document.getElementById("legacy-50th"),
    legacy5th: document.getElementById("legacy-5th"),
    legacyBoxNote: document.getElementById("legacy-box-note"), // NEW
    summaryLmpCost: document.getElementById("summary-lmp-cost"),
    summaryRiskStart: document.getElementById("summary-risk-start"),
    summaryW0: document.getElementById("summary-w0"),
    chartMainTitle: document.getElementById("chart-main-title"),
    chartSubtitle: document.getElementById("chart-subtitle"), // For subtitle update
  };

  const runSimButton = document.getElementById("run-sim");
  const exportCsvButton = document.getElementById("export-csv");
  const spendingChartCanvas = document.getElementById("spending-chart");
  let spendingChart = null;
  let allSimData = [];
  let currentChartSettingsForRedraw = null;
  let rawResultsByYear = []; // Store raw real results for toggling nominal display

  // --- Helper Functions ---
  const parseFloatInput = (element, defaultValue = 0) =>
    parseFloat(element.value) || defaultValue;
  const parseIntInput = (element, defaultValue = 0) =>
    parseInt(element.value) || defaultValue;

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

  function formatCurrency(
    value,
    displayNominal = false,
    settings = null,
    yearIndex = 0
  ) {
    let finalValue = value;
    if (displayNominal && settings) {
      const cumulativeInflation = Math.pow(
        1 + settings.expectedInflation / 100,
        yearIndex
      );
      finalValue *= cumulativeInflation;
    }
    return finalValue.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  // Overloaded formatCurrency for single values (legacy, summary)
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
    if (balance <= 0 && legacyTarget <= 0) return 0; // Cannot withdraw if balance and legacy are zero or less
    if (balance <= 0 && legacyTarget > 0) return 0; // Cannot meet positive legacy with no balance

    const adjustedBalanceForWithdrawal =
      balance - legacyTarget / Math.pow(1 + rate, years);

    if (adjustedBalanceForWithdrawal <= 0) return 0; // No surplus to withdraw

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
    // All core calculations are in REAL terms. Inflation applied for capping IF nominal display is on, and for final display.
    const resultsByYear = Array(settings.horizonYears)
      .fill(null)
      .map(() => []); // Stores REAL spending components
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
        ); // Cannot withdraw more than available balance

        const lmpContributionReal =
          t < settings.lmpYears ? settings.lmpAmount : 0;
        let actualRiskWithdrawalReal = uncappedRiskWithdrawalReal; // Assume no cap initially

        // Apply Max Total Spending Cap
        if (
          settings.maxTotalSpending !== null &&
          settings.maxTotalSpending > 0
        ) {
          const totalUncappedRealSpending =
            lmpContributionReal + uncappedRiskWithdrawalReal;
          let effectiveRealCap = settings.maxTotalSpending; // User inputs cap in real year 0 dollars

          if (totalUncappedRealSpending > effectiveRealCap) {
            const preventativeSavingsReal =
              totalUncappedRealSpending - effectiveRealCap;
            actualRiskWithdrawalReal = Math.max(
              0,
              uncappedRiskWithdrawalReal - preventativeSavingsReal
            );
          }
        }
        actualRiskWithdrawalReal = Math.max(
          0,
          Math.min(actualRiskWithdrawalReal, currentBalanceReal)
        ); // Final check

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

        // Store REAL components
        resultsByYear[t].push({
          lmpComponentReal: lmpContributionReal,
          riskComponentReal: actualRiskWithdrawalReal,
        });

        simPath.push({
          // Store real values for CSV, convert if needed during export
          year: t + 1,
          sim: i + 1,
          startBalanceReal: t === 0 ? riskStart : simPath[t - 1].endBalanceReal,
          lmpPaymentReal: lmpContributionReal,
          riskWithdrawalReal: actualRiskWithdrawalReal,
          totalSpendingReal: lmpContributionReal + actualRiskWithdrawalReal,
          endBalanceReal: currentBalanceReal,
          cumulativeInflation: cumulativeInflationFactor, // For potential nominal export
        });

        Wt_minus_1_real = Wt_next_real;
      }
      legacyOutcomesReal.push(currentBalanceReal);
      allSimData.push(...simPath);
    }
    rawResultsByYear = resultsByYear; // Save raw real results
    return { resultsByYear, legacyOutcomesReal }; // Return REAL values
  }

  // --- Aggregation & Percentiles --- (operates on whatever data is passed - real or nominal)
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

    // Process results to be nominal IF requested for chart display
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

    // Legacy outcomes processing
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

    if (settings.showSources) {
      const lmpDataSeries = [];
      const risk5thData = [],
        riskMedianData = [],
        risk95thData = [];

      processedResultsByYear.forEach((yearDataPoints) => {
        lmpDataSeries.push(
          yearDataPoints[0] ? yearDataPoints[0].lmpComponent : 0
        ); // LMP is fixed for this year after nominal conversion

        const riskSpendingValues = yearDataPoints.map((dp) => dp.riskComponent);
        const p = calculatePercentiles(riskSpendingValues);
        risk5thData.push(p[0.05]);
        riskMedianData.push(p[0.5]);
        risk95thData.push(p[0.95]);
      });

      datasets.push({
        label: `LMP Guaranteed (${dollarType})`,
        data: lmpDataSeries,
        backgroundColor: "rgba(75, 192, 192, 0.6)",
        stack: "SpendingStack",
        order: 3,
      });
      datasets.push({
        label: `Risk Portfolio (5th Perc. ${dollarType})`,
        data: risk5thData.map((val) => Math.max(0, val)), // ensure non-negative for stacking diffs
        backgroundColor: "rgba(255, 99, 132, 0.2)",
        stack: "SpendingStack",
        order: 2,
      });
      datasets.push({
        label: `Risk Portfolio (Median - 5th Perc. ${dollarType})`,
        data: riskMedianData.map((m, idx) => Math.max(0, m - risk5thData[idx])),
        backgroundColor: "rgba(255, 159, 64, 0.5)",
        stack: "SpendingStack",
        order: 2,
      });
      datasets.push({
        label: `Risk Portfolio (95th - Median Perc. ${dollarType})`,
        data: risk95thData.map((m, idx) =>
          Math.max(0, m - riskMedianData[idx])
        ),
        backgroundColor: "rgba(255, 205, 86, 0.5)",
        stack: "SpendingStack",
        order: 2,
      });
      datasets.push({
        label: `Total Median Spending (${dollarType})`,
        data: lmpDataSeries.map((lmp, idx) =>
          Math.max(0, lmp + riskMedianData[idx])
        ),
        type: "line",
        borderColor: "#3e6482",
        fill: false,
        tension: 0.1,
        borderWidth: 2,
        pointRadius: 0,
        order: 1,
      });
    } else {
      // Not showing sources, show total spending range
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

    const currencySymbol = formatSimpleCurrency(0).charAt(0); // Get $ or other symbol
    const chartConfig = {
      type: "bar",
      data: { labels: chartLabels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: "Retirement Year / Age" },
            stacked: settings.showSources,
          },
          y: {
            title: {
              display: true,
              text: `${timeUnit} Spending (${currencySymbol}, ${dollarType})`,
            },
            beginAtZero: true,
            ticks: {
              callback: (value) =>
                formatSimpleCurrency(value).replace(/\.\d+$/, ""),
            },
            stacked: settings.showSources,
          },
        },
        plugins: {
          tooltip: {
            enabled: true,
            mode: "index",
            intersect: false,
            callbacks: {
              label: function (context) {
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
              },
              title: function (tooltipItems) {
                const yearIndex = tooltipItems[0].dataIndex;
                const age = startAge + yearIndex;
                const birthDate = new Date(settings.userBirthdate);
                // Calendar year calc needs to be careful if birth month/day > current month/day
                let calendarYear = birthDate.getFullYear() + age;
                if (
                  new Date().getMonth() < birthDate.getMonth() ||
                  (new Date().getMonth() === birthDate.getMonth() &&
                    new Date().getDate() < birthDate.getDate())
                ) {
                  calendarYear--; // If birthday hasn't occurred this year yet
                }
                return `Age: ${age} (Approx. ${calendarYear})`;
              },
            },
          },
          legend: { position: "top" },
        },
        interaction: { mode: "index", axis: "x", intersect: false },
      },
    };

    // Tooltip adjustment for stacked bars to show total (if "show sources")
    if (settings.showSources) {
      let tooltipItemsBeingProcessed = -1; // Helper for tooltip total
      chartConfig.options.plugins.tooltip.callbacks.label = function (context) {
        let label = context.dataset.label || "";
        if (label) label += ": ";
        label += formatSimpleCurrency(context.parsed.y);

        if (
          context.dataset.stack === "SpendingStack" &&
          context.chart.isDatasetVisible(context.datasetIndex)
        ) {
          if (tooltipItemsBeingProcessed !== context.dataIndex) {
            let total = 0;
            context.chart.data.datasets.forEach((ds, i) => {
              if (
                ds.stack === "SpendingStack" &&
                context.chart.isDatasetVisible(i)
              ) {
                const value = ds.data[context.dataIndex];
                if (typeof value === "number") total += value;
              }
            });
            tooltipItemsBeingProcessed = context.dataIndex;
            return [label, `Total Stack: ${formatSimpleCurrency(total)}`];
          } else {
            return label; // Only return primary label for subsequent items in same stack/index
          }
        }
        return label;
      };
      chartConfig.options.plugins.tooltip.callbacks.afterBody = function () {
        tooltipItemsBeingProcessed = -1;
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

    const rows = dataToExport.map((row) => {
      if (displayNominal) {
        // Convert relevant currency columns to nominal for export
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
        // Rename headers for nominal export
        if (header.includes("Real")) {
          // do this only once
          header = header.replace(/Real/g, "Nominal");
        }
        return Object.values(nominalRow).join(",");
      } else {
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
  let lastSimResults = null; // Store results to avoid re-simulating for display-only changes

  function runSimulation(forceResimulate = false) {
    const stockPct = parseFloatInput(inputs.stockPct);
    const bondPct = parseFloatInput(inputs.bondPct);
    if (Math.abs(stockPct + bondPct - 100) > 0.1) {
      if (
        !confirm(
          `Stock % (${stockPct}%) + Bond % (${bondPct}%) does not equal 100%. Continue anyway?`
        )
      ) {
        return;
      }
    }

    const settings = {
      userBirthdate: inputs.userBirthdate.value,
      expectedInflation: parseFloatInput(inputs.expectedInflation, 2.5), // NEW
      lmpAmount: parseFloatInput(inputs.lmpAmount, 0),
      lmpRate: parseFloatInput(inputs.lmpRate, 0),
      lmpYears: parseIntInput(inputs.lmpYears, 30),
      startBalance: parseFloatInput(inputs.startBalance, 0),
      horizonYears: parseIntInput(inputs.horizonYears, 30),
      stockPct: stockPct,
      bondPct: bondPct,
      stockReturn: parseFloatInput(inputs.stockReturn, 7),
      stockSigma: parseFloatInput(inputs.stockSigma, 15),
      bondReturn: parseFloatInput(inputs.bondReturn, 2.5),
      bondSigma: parseFloatInput(inputs.bondSigma, 5),
      legacyTarget: parseFloatInput(inputs.legacyTarget, 0),
      nSims: parseIntInput(inputs.nSims, 1000),
      maxTotalSpending: inputs.maxTotalSpending.value
        ? parseFloatInput(inputs.maxTotalSpending)
        : null, // UPDATED
      showSources: inputs.showSources.checked,
      displayMonthly: inputs.displayMonthly.checked,
      displayNominal: inputs.displayNominal.checked, // NEW
      currentAge:
        new Date().getFullYear() -
        new Date(inputs.userBirthdate.value).getFullYear(),
    };
    currentChartSettingsForRedraw = settings;

    // Only re-run Monte Carlo if core financial parameters changed or forced
    if (forceResimulate || !lastSimResults) {
      runSimButton.disabled = true;
      runSimButton.textContent = "Simulating...";

      setTimeout(() => {
        // UI update before heavy computation
        const { resultsByYear, legacyOutcomesReal } = runMonteCarlo(settings);
        lastSimResults = { resultsByYear, legacyOutcomesReal }; // Store REAL results
        updateChart(
          lastSimResults.resultsByYear,
          lastSimResults.legacyOutcomesReal,
          settings
        );

        runSimButton.disabled = false;
        runSimButton.textContent = "Run Simulation";
      }, 10);
    } else {
      // If only display settings changed (like nominal/monthly/show_sources), just update chart
      updateChart(
        lastSimResults.resultsByYear,
        lastSimResults.legacyOutcomesReal,
        settings
      );
    }
  }

  // --- Event Listeners ---
  runSimButton.addEventListener("click", () => runSimulation(true)); // Force re-simulation on button click

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

  // Listeners for toggles that only affect display (don't need full re-simulation if results exist)
  [inputs.showSources, inputs.displayMonthly, inputs.displayNominal].forEach(
    (input) => {
      input.addEventListener("change", () => {
        if (lastSimResults) {
          // If a simulation has been run
          runSimulation(false); // Re-run with false to only update chart
        }
      });
    }
  );

  inputs.stockPct.addEventListener("change", () => {
    const stockVal = parseFloatInput(inputs.stockPct, 60);
    if (stockVal >= 0 && stockVal <= 100) {
      inputs.bondPct.value = 100 - stockVal;
    }
    lastSimResults = null; // Invalidate cache if input changes
  });
  inputs.bondPct.addEventListener("change", () => {
    const bondVal = parseFloatInput(inputs.bondPct, 40);
    if (bondVal >= 0 && bondVal <= 100) {
      inputs.stockPct.value = 100 - bondVal;
    }
    lastSimResults = null; // Invalidate cache
  });

  // Invalidate lastSimResults if any core input changes
  const coreInputsForResimulation = [
    inputs.userBirthdate,
    inputs.expectedInflation,
    inputs.lmpAmount,
    inputs.lmpRate,
    inputs.lmpYears,
    inputs.startBalance,
    inputs.horizonYears /* stock/bond % handled above */,
    inputs.stockReturn,
    inputs.stockSigma,
    inputs.bondReturn,
    inputs.bondSigma,
    inputs.legacyTarget,
    inputs.nSims,
    inputs.maxTotalSpending,
  ];
  coreInputsForResimulation.forEach((input) => {
    input.addEventListener("change", () => {
      lastSimResults = null;
    });
  });
});
