# Method - todo.list

读取机器人为创建人、对话人为参与人选的待办列表（按 update_time 降序），返回标题/描述/人名

## Usage

```bash
wecom-cli todo list --json <request_body>
```

## Declarations

```ts
export {
  BotTodoGetListReq as RequestBody,
  BotTodoGetListRsp as Response,
};

/** 机器人视角待办列表：按参与人筛选、按 update_time 降序 */
interface BotTodoGetListReq {
  /** 创建开始时间，格式：YYYY-MM-DD HH:mm:ss */
  create_begin_time?: string;
  /** 创建结束时间，格式：YYYY-MM-DD HH:mm:ss */
  create_end_time?: string;
  /**
   * 游标，用于分页
   *
   * @maxLength 256
   */
  cursor?: string;
  /** 截止开始时间，格式：YYYY-MM-DD HH:mm:ss */
  deadline_begin_time?: string;
  /** 截止结束时间，格式：YYYY-MM-DD HH:mm:ss */
  deadline_end_time?: string;
  /**
   * 关键词过滤：单元素内空格 AND，多元素之间 OR
   *
   * @maxItems 100
   */
  keywords?: string[];
  /**
   * 最大返回数量，默认10，最大20
   *
   * @format uint32
   * @minimum 1
   * @maximum 20
   */
  limit?: number;
  /**
   * 状态过滤，为空时默认返回 proceed
   *
   * @maxItems 2
   */
  status_filter?: ("finished" | "proceed")[];
}

interface BotTodoGetListRsp {
  /** 是否还有更多 */
  has_more?: boolean;
  /** 待办列表 */
  items?: TodoListItem[];
  /** 待办列表 数组元素数量 */
  items_count?: number;
  /** 下一页游标 */
  next_cursor?: string;
}

interface TodoListItem {
  /** 创建时间，格式：YYYY-MM-DD HH:mm:ss */
  create_time?: string;
  /** 创建人信息对象 */
  creator?: UserInfoRsp;
  /** 截止时间 */
  deadline?: Deadline;
  /** 待办描述 */
  description?: string;
  /** 补充信息，例如：将会在 YYYY-MM-DD HH:mm:ss 时间提醒 */
  extra_info?: string;
  /** 参与人列表 */
  followers?: TodoFollowerRsp[];
  /** 待办来源 */
  source?: "single_chat" | "group_chat" | "doc" | "ai_summary" | "meeting_summary" | "face_chat" | "fused_doc" | "smart_sheet" | "smart_doc" | "JSAPI";
  /** 待办状态 */
  status?: "finished" | "proceed" | "deleted";
  /** 待办标题 */
  title?: string;
  /** 待办 id */
  todo_id?: string;
  /** 更新时间，格式：YYYY-MM-DD HH:mm:ss */
  update_time?: string;
  /** 用户状态 */
  user_status?: "reject" | "accept" | "finished" | "removed" | "notshow";
}

/** 用户信息 */
interface UserInfoRsp {
  /** 用户 userid对应成员的名称 */
  user_name?: string;
  /** 用户 userid */
  userid?: string;
}

interface Deadline {
  /** 截止时间类型：date=日期，datetime=具体时刻 */
  type?: "date" | "datetime";
  /**
   * 截止时间字符串：date=YYYY-MM-DD，datetime=YYYY-MM-DD HH:mm:ss
   *
   * @minLength 1
   * @maxLength 32
   */
  value?: string;
}

/** 参与人信息 */
interface TodoFollowerRsp {
  /** 更新时间，格式：YYYY-MM-DD HH:mm:ss, todo create 不返回 */
  update_time?: string;
  /** 参与人 userid对应成员的名称 */
  user_name?: string;
  /** 参与人状态, todo create 不返回 */
  user_status?: "reject" | "accept" | "finished" | "removed" | "notshow";
  /** 参与人 userid */
  userid?: string;
}
```
