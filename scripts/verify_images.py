#!/usr/bin/env python3
"""
验证 questions.json 中的图片路径是否与实际文件匹配
"""
import json
from pathlib import Path

def verify_images():
    json_file = Path("data/source/questions.json")
    public_dir = Path("web/public")
    
    if not json_file.exists():
        print("❌ questions.json 不存在")
        return False
    
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    questions = data.get('questions', [])
    print(f"📊 总题目数: {len(questions)}")
    
    # 统计
    question_image_paths = []
    option_image_paths = []
    
    for q in questions:
        for img in q.get('questionImages', []):
            question_image_paths.append((q['id'], img))
        for opt in q.get('options', []):
            if opt.get('imagePath'):
                option_image_paths.append((q['id'], opt['imagePath']))
    
    print(f"📸 题目图片路径数: {len(question_image_paths)}")
    print(f"🖼️  选项图片路径数: {len(option_image_paths)}")
    
    # 检查文件是否存在
    missing_question = []
    missing_option = []
    
    for qid, img_path in question_image_paths:
        clean_path = img_path.lstrip('/')
        if not clean_path.startswith('images/'):
            clean_path = f"images/{clean_path}"
        full_path = public_dir / clean_path
        if not full_path.exists():
            missing_question.append((qid, img_path))
    
    for qid, img_path in option_image_paths:
        clean_path = img_path.lstrip('/')
        if not clean_path.startswith('images/'):
            clean_path = f"images/{clean_path}"
        full_path = public_dir / clean_path
        if not full_path.exists():
            missing_option.append((qid, img_path))
    
    # 结果
    total_missing = len(missing_question) + len(missing_option)
    total_referenced = len(question_image_paths) + len(option_image_paths)
    
    if total_missing == 0:
        print(f"\n✅ 所有图片路径都正确！({total_referenced}/{total_referenced})")
        return True
    else:
        print(f"\n❌ 发现 {total_missing} 个缺失的图片路径:")
        if missing_question:
            print(f"  题目图片缺失: {len(missing_question)}")
            print("  示例（前3个）:")
            for qid, path in missing_question[:3]:
                print(f"    - {qid}: {path}")
        if missing_option:
            print(f"  选项图片缺失: {len(missing_option)}")
            print("  示例（前3个）:")
            for qid, path in missing_option[:3]:
                print(f"    - {qid}: {path}")
        return False

if __name__ == "__main__":
    verify_images()
