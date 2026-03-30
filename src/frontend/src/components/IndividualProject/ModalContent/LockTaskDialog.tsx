import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@Components/RadixComponents/Button';
import { ProjectUser, useGetUsersQuery } from '@Api/projects';
import { createMentionToken } from '@Utils/mentions';

interface ILockTaskDialogProps {
  handleLockTask: (comment: string) => void;
  setShowLockDialog: React.Dispatch<React.SetStateAction<boolean>>;
}

interface SelectedMention {
  id: string;
  displayText: string;
  token: string;
}

const MENTION_MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

const LockTaskDialog = ({
  handleLockTask,
  setShowLockDialog,
}: ILockTaskDialogProps) => {
  const [comment, setComment] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [debouncedMentionQuery, setDebouncedMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the mention query before triggering the API call
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (mentionQuery !== null && mentionQuery.length >= MENTION_MIN_CHARS) {
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedMentionQuery(mentionQuery);
      }, DEBOUNCE_MS);
    } else {
      setDebouncedMentionQuery(null);
    }
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [mentionQuery]);

  const { data: users } = useGetUsersQuery({
    enabled: debouncedMentionQuery !== null,
  });

  // Filter users client-side using the live (non-debounced) query for responsiveness
  const filteredUsers =
    mentionQuery !== null && mentionQuery.length >= MENTION_MIN_CHARS && users
      ? users.filter((user: ProjectUser) =>
          user.name.toLowerCase().includes(mentionQuery.toLowerCase()),
        )
      : [];

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = e.target;
    setComment(value);
    setSelectedMentions(prev =>
      prev.filter(mention => value.includes(mention.displayText)),
    );

    // Check if we're in a mention context
    const textBeforeCursor = value.slice(0, selectionStart);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Only show dropdown if there's no space before @ (or @ is at start) and no space in the query
      const charBeforeAt = lastAtIndex > 0 ? value[lastAtIndex - 1] : ' ';
      if (
        (charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0) &&
        !textAfterAt.includes(' ')
      ) {
        setMentionQuery(textAfterAt);
        setMentionStartIndex(lastAtIndex);
        setSelectedMentionIndex(0);
        return;
      }
    }

    setMentionQuery(null);
    setMentionStartIndex(-1);
  };

  const insertMention = useCallback(
    (user: ProjectUser) => {
      const before = comment.slice(0, mentionStartIndex);
      const after = comment.slice(
        mentionStartIndex + (mentionQuery?.length || 0) + 1,
      );
      const displayText = `@${user.name}`;
      const mentionToken = createMentionToken(user.name, String(user.id));
      const newComment = `${before}${displayText} ${after}`;
      setComment(newComment);
      setSelectedMentions(prev => [
        ...prev,
        { id: `${user.id}-${prev.length}`, displayText, token: mentionToken },
      ]);
      setMentionQuery(null);
      setMentionStartIndex(-1);

      // Refocus textarea after insertion
      setTimeout(() => {
        if (textareaRef.current) {
          const cursorPos = mentionStartIndex + displayText.length + 1;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        }
      }, 0);
    },
    [comment, mentionStartIndex, mentionQuery],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex(prev =>
          prev < filteredUsers.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex(prev =>
          prev > 0 ? prev - 1 : filteredUsers.length - 1,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertMention(filteredUsers[selectedMentionIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
      }
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (dropdownRef.current && mentionQuery !== null) {
      const selected = dropdownRef.current.children[
        selectedMentionIndex
      ] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedMentionIndex, mentionQuery]);

  const serializeCommentMentions = useCallback(() => {
    let serializedComment = comment;

    selectedMentions.forEach(({ displayText, token }) => {
      if (serializedComment.includes(displayText)) {
        serializedComment = serializedComment.replace(displayText, token);
      }
    });

    return serializedComment;
  }, [comment, selectedMentions]);

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
      <p className="naxatw-text-body-md naxatw-text-grey-800">
        Add an optional comment. Use <strong>@</strong> to tag a user.
      </p>
      <div className="naxatw-relative">
        <textarea
          ref={textareaRef}
          className="naxatw-flex naxatw-h-[80px] naxatw-w-full naxatw-resize-none naxatw-rounded-[4px] naxatw-border naxatw-border-[#555555] naxatw-bg-transparent naxatw-p-2 naxatw-text-body-md hover:naxatw-border-red focus:naxatw-border-red focus:naxatw-bg-transparent focus:naxatw-outline-none"
          placeholder="e.g. Locked for @Joe - Team ZimZam"
          value={comment}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        {mentionQuery !== null && filteredUsers.length > 0 && (
          <div
            ref={dropdownRef}
            className="naxatw-absolute naxatw-left-0 naxatw-z-20 naxatw-mt-1 naxatw-max-h-[160px] naxatw-w-full naxatw-overflow-y-auto naxatw-rounded-[4px] naxatw-border naxatw-border-grey-400 naxatw-bg-white naxatw-shadow-lg"
          >
            {filteredUsers.map(
              (user: ProjectUser, index: number) => (
                <button
                  key={user.id}
                  type="button"
                  className={`naxatw-flex naxatw-w-full naxatw-items-center naxatw-gap-2 naxatw-px-3 naxatw-py-2 naxatw-text-left naxatw-text-body-md hover:naxatw-bg-grey-100 ${
                    index === selectedMentionIndex
                      ? 'naxatw-bg-grey-100'
                      : ''
                  }`}
                  onClick={() => insertMention(user)}
                >
                  {user.profile_img ? (
                    <img
                      src={user.profile_img}
                      alt=""
                      className="naxatw-h-5 naxatw-w-5 naxatw-rounded-full"
                    />
                  ) : (
                    <div className="naxatw-flex naxatw-h-5 naxatw-w-5 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-grey-400 naxatw-text-[10px] naxatw-text-white">
                      {user.name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <span>{user.name}</span>
                </button>
              ),
            )}
          </div>
        )}
      </div>
      <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
        <Button
          className="!naxatw-text-red"
          onClick={() => setShowLockDialog(false)}
        >
          Cancel
        </Button>
        <Button
          className="naxatw-bg-red"
          onClick={() => {
            handleLockTask(serializeCommentMentions());
            setShowLockDialog(false);
          }}
        >
          Lock Task
        </Button>
      </div>
    </div>
  );
};

export default LockTaskDialog;
