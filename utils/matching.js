function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean);
}

function intersectionCount(arr1, arr2) {
  const set2 = new Set(arr2);
  return arr1.filter((word) => set2.has(word)).length;
}

function detectCategory(report) {
  const text = normalizeText(
    `${report.itemName || ""} ${report.category || ""} ${report.description || ""}`
  );

  const rules = [
    { category: "Wallet", keywords: ["wallet", "purse", "cardholder"] },
    { category: "Phone", keywords: ["phone", "iphone", "samsung", "mobile"] },
    { category: "Bag", keywords: ["bag", "backpack", "handbag", "luggage"] },
    { category: "Keys", keywords: ["key", "keys", "keychain"] },
    { category: "Passport", keywords: ["passport"] },
    { category: "Watch", keywords: ["watch"] },
    { category: "Laptop", keywords: ["laptop", "macbook"] },
    { category: "Earbuds", keywords: ["airpods", "earbuds", "headphones"] }
  ];

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.category;
    }
  }

  return report.category || "Other";
}

function getImageSimilarityScore(source, target) {
  const sourceName = normalizeText(source.itemName);
  const targetName = normalizeText(target.itemName);
  const sourceCategory = normalizeText(source.category);
  const targetCategory = normalizeText(target.category);

  if (sourceName && targetName && sourceName === targetName) return 24;
  if (sourceCategory && targetCategory && sourceCategory === targetCategory) return 18;
  return 8;
}

function scoreReports(source, target) {
  let score = 0;

  const sourceName = normalizeText(source.itemName);
  const targetName = normalizeText(target.itemName);

  const sourceCategory = normalizeText(source.category);
  const targetCategory = normalizeText(target.category);

  const sourceLocation = normalizeText(source.location);
  const targetLocation = normalizeText(target.location);

  const sourceVenue = normalizeText(source.venueType);
  const targetVenue = normalizeText(target.venueType);

  const sourceCityArea = normalizeText(source.cityArea);
  const targetCityArea = normalizeText(target.cityArea);

  const sourceDescTokens = tokenize(`${source.itemName} ${source.description} ${source.category}`);
  const targetDescTokens = tokenize(`${target.itemName} ${target.description} ${target.category}`);

  if (sourceCategory && targetCategory && sourceCategory === targetCategory) {
    score += 26;
  }

  if (sourceName && targetName && sourceName === targetName) {
    score += 18;
  }

  score += getImageSimilarityScore(source, target);

  if (sourceVenue && targetVenue && sourceVenue === targetVenue) {
    score += 15;
  }

  if (sourceLocation && targetLocation && sourceLocation === targetLocation) {
    score += 15;
  }

  if (sourceCityArea && targetCityArea && sourceCityArea === targetCityArea) {
    score += 10;
  }

  if (source.date && target.date && source.date === target.date) {
    score += 8;
  }

  if (source.time && target.time && source.time === target.time) {
    score += 4;
  }

  const commonWords = intersectionCount(sourceDescTokens, targetDescTokens);
  score += Math.min(commonWords * 4, 20);

  return Math.min(score, 100);
}

function findPossibleMatches(newReport, allReports) {
  const oppositeType = newReport.type === "lost" ? "found" : "lost";

  return allReports
    .filter((report) => report.type === oppositeType && report.status !== "Resolved")
    .map((report) => {
      const confidence = scoreReports(newReport, report);
      return {
        reportId: report._id,
        itemName: report.itemName,
        category: report.category,
        location: report.location,
        cityArea: report.cityArea || "",
        venueType: report.venueType || "",
        confidence,
        imageSimilarityScore: getImageSimilarityScore(newReport, report)
      };
    })
    .filter((match) => match.confidence >= 35)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

function isDuplicate(newReport, existingReports) {
  return existingReports.some((report) => {
    if (report.type !== newReport.type) return false;
    const duplicateScore = scoreReports(newReport, report);
    return duplicateScore >= 75;
  });
}

module.exports = {
  detectCategory,
  scoreReports,
  findPossibleMatches,
  isDuplicate,
  getImageSimilarityScore
};