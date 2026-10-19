# Method - todo.delete

机器人视角批量删除待办

## Usage

```bash
wecom-cli todo delete --json <request_body>
```

## Declarations

```ts
export {
  TodoDeleteReq as RequestBody,
  TodoDeleteRsp as Response,
};

interface TodoDeleteReq {
  /**
   * 批量删除待办列表，最多20条
   *
   * @minItems 1
   * @maxItems 20
   */
  items?: TodoDeleteItem[];
}

interface TodoDeleteRsp {
  /** 批量删除结果列表 */
  items?: TodoDeleteResultItem[];
  /** 批量删除结果列表 数组元素数量 */
  items_count?: number;
}

/** 单条 delete 入参子消息 */
interface TodoDeleteItem {
  /** 待办 id */
  todo_id: string;
}

/** 单条 delete 结果子消息 */
interface TodoDeleteResultItem {
  /** 错误信息（success=false 时有值） */
  errmsg?: string;
  /** 是否成功 */
  success?: boolean;
  /** 待办标题 */
  title?: string;
  /** 待办 id */
  todo_id?: string;
}
```
