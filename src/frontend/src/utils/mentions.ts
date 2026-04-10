const MENTION_TOKEN_REGEX = /@\[(.+?)\]\((.+?)\)/g;

export const createMentionToken = (displayName: string, userId: string) =>
  `@[${displayName}](${userId})`;

export const commentMentionsUserId = (
  comment: string | null | undefined,
  userId: string | number | null | undefined,
) => {
  if (!comment || !userId) return false;
  const targetId = String(userId);

  return Array.from(comment.matchAll(MENTION_TOKEN_REGEX)).some((match) => match[2] === targetId);
};

export const renderCommentMentions = (comment: string | null | undefined) => {
  if (!comment) return comment;
  return comment.replace(MENTION_TOKEN_REGEX, "@$1");
};
