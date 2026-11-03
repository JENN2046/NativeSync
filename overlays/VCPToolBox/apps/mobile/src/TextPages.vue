<script setup>
import {computed,ref,watch} from 'vue';
const props=defineProps({text:{type:String,default:''},complete:{type:Boolean,default:true}}),page=ref(0),pageSize=16000;
const offsets=computed(()=>{const ends=[0];let start=0;while(start<props.text.length){let end=Math.min(start+pageSize,props.text.length);if(end<props.text.length&&/[\uD800-\uDBFF]/.test(props.text[end-1])&&/[\uDC00-\uDFFF]/.test(props.text[end]))end++;ends.push(end);start=end;}return ends;});
const total=computed(()=>Math.max(1,offsets.value.length-1));
const content=computed(()=>props.text.slice(offsets.value[page.value],offsets.value[page.value+1]));
function choose(value){page.value=Math.max(0,Math.min(total.value-1,Math.trunc(Number(value)||1)-1));}
watch(()=>props.text,()=>{page.value=0;});
</script>
<template>
 <div class="text-pages">
  <div v-if="total>1" class="text-page-controls"><button @click="page--" :disabled="page===0" aria-label="上一页文本">上一页</button><label>第 <input type="number" min="1" :max="total" :value="page+1" @change="choose($event.target.value)" aria-label="文本页码"> / {{total}} 页</label><button @click="page++" :disabled="page===total-1" aria-label="下一页文本">下一页</button><small>{{complete?'全文保留':'预览内容'}}</small></div>
  <pre>{{content}}</pre>
 </div>
</template>
<style scoped>
.text-pages{min-width:0;max-width:100%}.text-pages pre{margin:0;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.text-page-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:11px}.text-page-controls button{padding:5px 8px;font-size:11px}.text-page-controls input{width:62px;max-width:100%;padding:4px}.text-page-controls small{width:100%;color:inherit;opacity:.85}
</style>
