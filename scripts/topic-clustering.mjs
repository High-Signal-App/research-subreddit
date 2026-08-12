export function summarizeTopicAssignments(topicLabels, texts, assignments) {
  const topics = topicLabels.map((label) => ({
    label,
    count: 0,
    similaritySum: 0,
    topMembers: [],
  }));

  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index];
    if (
      !Number.isInteger(assignment.topicIdx) ||
      assignment.topicIdx < 0 ||
      assignment.topicIdx >= topics.length
    ) {
      continue;
    }

    const topic = topics[assignment.topicIdx];
    topic.count += 1;
    topic.similaritySum += assignment.sim;

    const member = { index, sim: assignment.sim };
    const insertionIndex = topic.topMembers.findIndex(
      (candidate) => member.sim > candidate.sim,
    );
    if (insertionIndex >= 0) {
      topic.topMembers.splice(insertionIndex, 0, member);
      if (topic.topMembers.length > 5) topic.topMembers.pop();
    } else if (topic.topMembers.length < 5) {
      topic.topMembers.push(member);
    }
  }

  return topics
    .filter((topic) => topic.count > 0)
    .map((topic) => {
      const topExamples = topic.topMembers.map((member) => ({
        text: texts[member.index].slice(0, 150),
        sim: member.sim,
      }));
      return {
        label: topic.label,
        count: topic.count,
        avgSim: topic.similaritySum / topic.count,
        topSim: topic.topMembers[0]?.sim || 0,
        examples: topExamples.map((example) => example.text),
        exampleSims: topExamples.map((example) => example.sim),
      };
    })
    .sort((left, right) => right.count - left.count);
}
