import { logger } from '#utils/logtail.js';
import { isHomeGroup } from '../../utils/home.js';
import redisClient from '../../utils/redis.js';
import { Temporal } from '../../utils/temporal.js';

/**
 * Process poll created by user to not
 * @param {import('telegraf').Context<import('telegraf/typings/core/types/typegram').Update>} context
 * @param {import('redis').RedisClient} cache
 * @param {any} poll Telegram Poll object
 * @param {any} pollID Telegram ID to poll
 * @returns {Promise<void>}
 */
export async function poll(context, cache, poll, pollID) {
  const redis = redisClient(cache);
  const currentTime = new Temporal(new Date());

  const [getLastMessageContent, lastPinnedMessage, lastPollDate] = await redis.MGET(
    `poll:${String(context.message.chat.id)}:message:content`,
    `poll:${String(context.message.chat.id)}:message:id`,
    `poll:${String(context.message.chat.id)}:date`,
  );
  let lastMessageContent = JSON.parse(getLastMessageContent);

  if (!lastMessageContent || !currentTime.compare(new Date(lastPollDate), 'day')) {
    lastMessageContent = { survey: [], quiz: [] };
  }

  if (poll.type === 'regular') {
    lastMessageContent.survey.push({ id: pollID, text: poll.question.split(/\n/)[0] });
  } else if (poll.type === 'quiz') {
    lastMessageContent.quiz.push({ id: pollID, text: poll.question.split(/\n/)[0] });
  }

  const chat = await context.getChat();
  const chatLink = `https://t.me/${chat.username}`;

  const preformatMessage =
    `<strong>${currentTime.formatDate('id-ID', 'Asia/Jakarta', false, false)}</strong>\n\n` +
    `Quiz\n` +
    `${lastMessageContent.quiz.map((i) => `<a href="${chatLink}/${i.id}">${i.text}</a>`).join('\n')}\n\n` +
    `Survey\n` +
    `${lastMessageContent.survey.map((i) => `<a href="${chatLink}/${i.id}">${i.text}</a>`).join('\n')}\n`;

  if (lastPollDate && currentTime.compare(new Date(lastPollDate), 'day')) {
    // append to existing message
    await context.telegram.editMessageText(context.message.chat.id, Number(lastPinnedMessage), '', preformatMessage, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    await redis.MSET(`poll:${String(context.message.chat.id)}:message:content`, JSON.stringify(lastMessageContent));
    await logger.fromContext(context, 'poll', {
      actions: `Edited a message: ${Number(lastPinnedMessage)}`,
      sendText: preformatMessage,
    });
    return;
  }

  // create new message
  const response = await context.telegram.sendMessage(context.message.chat.id, preformatMessage, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  await logger.fromContext(context, 'poll', {
    actions: `Message sent: ${response.message_id}`,
    sendText: preformatMessage,
  });

  await redis.MSET(
    `poll:${String(context.message.chat.id)}:message:id`,
    String(response.message_id),
    `poll:${String(context.message.chat.id)}:message:content`,
    JSON.stringify(lastMessageContent),
    `poll:${String(context.message.chat.id)}:date`,
    currentTime.date.toISOString(),
  );
  await context.telegram.pinChatMessage(context.message.chat.id, response.message_id, {
    disable_notification: false,
  });
  await logger.fromContext(context, 'poll', { actions: 'Pinned a message' });
}

/**
 * Send help to user when needed.
 * @param {import('telegraf').Telegraf} bot
 * @param {import('redis').RedisClient} cache
 * @returns {{command: String, description: String}[]}
 */
export function register(bot, cache) {
  bot.on('message', async (context, next) => {
    // Only works on supergroup
    if (context.message?.poll && context.message?.chat?.type === 'supergroup') {
      if (!isHomeGroup(context)) return;
      await poll(context, cache, context.message.poll, context.message.message_id);
      return;
    }

    return next();
  });

  return [];
}

export default poll;
